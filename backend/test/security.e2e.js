/**
 * End-to-end verification of the authorization fixes against a live API.
 * Asserts behaviour over HTTP, not mocks.
 */
const BASE = "http://127.0.0.1:4100/api/v1";

let pass = 0;
let fail = 0;

function check(name, condition, detail) {
  if (condition) {
    pass++;
    console.log("  [PASS] " + name);
  } else {
    fail++;
    console.log("  [FAIL] " + name + (detail ? " -> " + JSON.stringify(detail) : ""));
  }
}

async function req(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      // Only declare a JSON content-type when there is actually a body;
      // Fastify rejects an empty body under application/json.
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, body: json };
}

async function login(email, password) {
  const r = await req("POST", "/auth/login", { body: { email, password } });
  if (r.status !== 200 && r.status !== 201) throw new Error("login failed for " + email + ": " + JSON.stringify(r.body));
  return { access: r.body.accessToken ?? r.body.data?.accessToken, refresh: r.body.refreshToken ?? r.body.data?.refreshToken };
}

const uniq = Date.now();

async function main() {
  const sa = await login("admin@mederp.com", "Admin@123");
  console.log("[setup] super_admin logged in");

  const branches = await req("GET", "/branches", { token: sa.access });
  const list = branches.body?.data ?? branches.body;
  const brn01 = list.find((b) => b.code === "BRN01");
  const brn02 = list.find((b) => b.code === "BRN02");
  if (!brn01 || !brn02) throw new Error("branches not found: " + JSON.stringify(list));
  console.log("[setup] BRN01=" + brn01.id.slice(0, 8) + " BRN02=" + brn02.id.slice(0, 8));

  // Two doctors on BRN01, one cashier on BRN02.
  const mk = async (email, role, branchId) => {
    const r = await req("POST", "/auth/register", {
      token: sa.access,
      body: { email, password: "Passw0rd1", firstName: "Test", lastName: role, role, branchId },
    });
    if (r.status >= 300) throw new Error("register " + email + " failed: " + JSON.stringify(r.body));
    return r;
  };
  // Every actor is created per-run so the suite mutates no seeded account and
  // stays re-runnable without a database reset.
  const docAEmail = `doca${uniq}@mederp.com`;
  const docBEmail = `docb${uniq}@mederp.com`;
  const cash01Email = `cash01${uniq}@mederp.com`;
  const cash02Email = `cash02${uniq}@mederp.com`;
  await mk(docAEmail, "doctor", brn01.id);
  await mk(docBEmail, "doctor", brn01.id);
  await mk(cash01Email, "cashier", brn01.id);
  await mk(cash02Email, "cashier", brn02.id);
  console.log("[setup] created doctorA, doctorB, cashier (BRN01) + cashier (BRN02)");

  const docA = await login(docAEmail, "Passw0rd1");
  const docB = await login(docBEmail, "Passw0rd1");
  const cash02 = await login(cash02Email, "Passw0rd1");
  const cash01 = await login(cash01Email, "Passw0rd1");

  const docAId = JSON.parse(Buffer.from(docA.access.split(".")[1], "base64").toString()).sub;
  const docBId = JSON.parse(Buffer.from(docB.access.split(".")[1], "base64").toString()).sub;

  // Patients
  const mkPatient = async (name, phone) => {
    const r = await req("POST", "/patients", { token: cash01.access, body: { name, phone } });
    if (r.status >= 300) throw new Error("patient create failed: " + JSON.stringify(r.body));
    return r.body.data ?? r.body;
  };
  const p1 = await mkPatient("Ravi Test", "9" + String(uniq).slice(-9));
  const p2 = await mkPatient("Sita Test", "8" + String(uniq).slice(-9));
  console.log("[setup] patients created\n");

  // ── C1/C2: branch + doctor scoping on the queue ──────────────────────────
  console.log("C1/C2 - queue scoping");
  const tokA = await req("POST", "/clinic/tokens", {
    token: cash01.access,
    body: { patientId: p1.id, doctorId: docAId, date: todayPlus(1) },
  });
  check("cashier can create a token in own branch", tokA.status < 300, tokA.body);
  const tokenId = tokA.body?.data?.id;

  const crossBranch = await req("POST", "/clinic/tokens", {
    token: cash02.access,
    body: { patientId: p1.id, doctorId: docAId, date: todayPlus(1) },
  });
  check("cashier cannot book a doctor from another branch", crossBranch.status === 422, crossBranch.status);

  const peek = await req("GET", "/clinic/tokens?doctorId=" + docAId, { token: docB.access });
  check("doctor cannot query a colleague's queue (403)", peek.status === 403, peek.status);

  const ownQueue = await req("GET", "/clinic/tokens", { token: docB.access });
  const ownItems = ownQueue.body?.data?.data ?? ownQueue.body?.data ?? [];
  check("doctor with no doctorId sees only own queue", Array.isArray(ownItems) && ownItems.every((t) => t.doctorId === docBId), ownItems.map((t) => t.doctorId));

  const otherBranchRead = await req("GET", "/clinic/tokens/" + tokenId, { token: cash02.access });
  check("cross-branch token read blocked (403)", otherBranchRead.status === 403, otherBranchRead.status);

  // ── Doctor Patient Directory Scoping ─────────────────────────────────────
  console.log("\nDoctor Patient Directory Scoping");
  const docAPatients = await req("GET", "/patients", { token: docA.access });
  const docAPatientList = docAPatients.body?.data?.data ?? docAPatients.body?.data ?? [];
  check("doctor A sees only assigned patient (p1)", Array.isArray(docAPatientList) && docAPatientList.length === 1 && docAPatientList[0].id === p1.id, docAPatientList.map((p) => p.id));

  const docBPatients = await req("GET", "/patients", { token: docB.access });
  const docBPatientList = docBPatients.body?.data?.data ?? docBPatients.body?.data ?? [];
  check("doctor B sees no unassigned patients", Array.isArray(docBPatientList) && docBPatientList.length === 0, docBPatientList);

  const docBForbiddenSingle = await req("GET", "/patients/" + p1.id, { token: docB.access });
  check("doctor B blocked from reading unassigned patient (403)", docBForbiddenSingle.status === 403, docBForbiddenSingle.status);

  const cashPatients = await req("GET", "/patients", { token: cash01.access });
  const cashPatientList = cashPatients.body?.data?.data ?? cashPatients.body?.data ?? [];
  check("cashier sees full patient directory (all patients)", Array.isArray(cashPatientList) && cashPatientList.length >= 2, cashPatientList.length);

  // ── C3: patient PII allowlist ────────────────────────────────────────────
  console.log("\nC3 - patient PII allowlist");
  const detail = await req("GET", "/clinic/tokens/" + tokenId, { token: docA.access });
  const patient = detail.body?.data?.patient ?? {};
  const leaked = ["address", "insuranceId", "insuranceExpiry", "outstandingBalance", "loyaltyPoints", "notes", "email"].filter((k) => k in patient);
  check("no commercial/contact PII in token payload", leaked.length === 0, leaked);
  check("clinical fields still present", "allergies" in patient && "bloodGroup" in patient, Object.keys(patient));

  const doctorObj = detail.body?.data?.doctor ?? {};
  check("no password hash on embedded doctor", !("passwordHash" in doctorObj), Object.keys(doctorObj));

  // ── C4: ownership on update ──────────────────────────────────────────────
  console.log("\nC4 - update ownership");
  const foreignUpdate = await req("PATCH", "/clinic/tokens/" + tokenId, { token: docB.access, body: { status: "called" } });
  check("doctor cannot update a colleague's token (403)", foreignUpdate.status === 403, foreignUpdate.status);

  const ownUpdate = await req("PATCH", "/clinic/tokens/" + tokenId, { token: docA.access, body: { status: "called" } });
  check("owning doctor can update own token", ownUpdate.status < 300, ownUpdate.status);

  // ── C5: prescription must belong to the token's patient ──────────────────
  console.log("\nC5 - prescription link validation");
  const rxOther = await req("POST", "/prescriptions", {
    token: docA.access,
    body: { patientId: p2.id, doctorName: "Someone Else", issuedDate: todayPlus(0), expiryDate: todayPlus(30) },
  });
  const rxOtherId = rxOther.body?.data?.id;
  const badLink = await req("PATCH", "/clinic/tokens/" + tokenId, { token: docA.access, body: { prescriptionId: rxOtherId } });
  check("cross-patient prescription link rejected (422)", badLink.status === 422, { status: badLink.status, msg: badLink.body?.message });

  // ── M5: prescription attributed to the signed-in doctor ──────────────────
  console.log("\nM5 - prescription attribution");
  check("doctorName overridden with authenticated doctor", rxOther.body?.data?.doctorName !== "Someone Else", rxOther.body?.data?.doctorName);
  check("doctor-authored prescription auto-verified", rxOther.body?.data?.status === "verified", rxOther.body?.data?.status);

  // ── H1: deactivation invalidates the access token immediately ────────────
  console.log("\nH1 - deactivation takes effect immediately");
  const before = await req("GET", "/clinic/tokens", { token: docB.access });
  check("doctorB token works before deactivation", before.status === 200, before.status);
  const deact = await req("PATCH", "/users/" + docBId + "/deactivate", { token: sa.access });
  check("deactivate call succeeded", deact.status < 300, deact.status);
  const after = await req("GET", "/clinic/tokens", { token: docB.access });
  check("same access token rejected right after deactivation (401)", after.status === 401, after.status);

  // ── H2: password change invalidates outstanding access tokens ────────────
  console.log("\nH2 - password change invalidates access tokens");
  const cashBefore = await req("GET", "/clinic/tokens", { token: cash01.access });
  check("cashier token works before password change", cashBefore.status === 200, cashBefore.status);
  const chg = await req("POST", "/auth/change-password", {
    token: cash01.access,
    body: { currentPassword: "Passw0rd1", newPassword: "Passw0rd2", confirmPassword: "Passw0rd2" },
  });
  check("password change accepted", chg.status < 300, chg.body);
  const cashAfter = await req("GET", "/clinic/tokens", { token: cash01.access });
  check("old access token rejected after password change (401)", cashAfter.status === 401, cashAfter.status);

  // ── M4: changePassword is schema-validated ───────────────────────────────
  console.log("\nM4 - changePassword validation");
  const weak = await req("POST", "/auth/change-password", {
    token: docA.access,
    body: { currentPassword: "Passw0rd1", newPassword: "x", confirmPassword: "x" },
  });
  check("weak password rejected (400)", weak.status === 400, weak.status);

  // ── M3: refresh reuse revokes the family ─────────────────────────────────
  console.log("\nM3 - refresh token reuse detection");
  const fresh = await login(docAEmail, "Passw0rd1");
  const rotated = await req("POST", "/auth/refresh", { body: { refreshToken: fresh.refresh } });
  check("first refresh rotates successfully", rotated.status === 200, rotated.status);
  const newRefresh = rotated.body?.refreshToken ?? rotated.body?.data?.refreshToken;
  const replay = await req("POST", "/auth/refresh", { body: { refreshToken: fresh.refresh } });
  check("replaying the old refresh token is rejected (401)", replay.status === 401, replay.status);
  const afterReuse = await req("POST", "/auth/refresh", { body: { refreshToken: newRefresh } });
  check("reuse revoked the whole family - rotated token also dead (401)", afterReuse.status === 401, afterReuse.status);

  // ── L5: doctors cannot enumerate invoices ────────────────────────────────
  console.log("\nL5 - invoice enumeration");
  const docA2 = await login(docAEmail, "Passw0rd1");
  const allInv = await req("GET", "/billing/invoices", { token: docA2.access });
  check("doctor listing all invoices blocked (403)", allInv.status === 403, allInv.status);
  const scopedInv = await req("GET", "/billing/invoices?patientId=" + p1.id, { token: docA2.access });
  check("doctor scoped invoice query allowed", scopedInv.status === 200, scopedInv.status);

  // ── L4: duplicate + backdated guards ─────────────────────────────────────
  console.log("\nL4 - token creation guards");
  const dup = await req("POST", "/clinic/tokens", {
    token: cash02.access, body: { patientId: p1.id, doctorId: docAId, date: todayPlus(1) },
  });
  const cash01b = await login(cash01Email, "Passw0rd2");
  const dup2 = await req("POST", "/clinic/tokens", {
    token: cash01b.access, body: { patientId: p1.id, doctorId: docAId, date: todayPlus(1) },
  });
  check("duplicate open token for same patient/doctor/day rejected", dup2.status === 422, { status: dup2.status, msg: dup2.body?.message });
  const past = await req("POST", "/clinic/tokens", {
    token: cash01b.access, body: { patientId: p2.id, doctorId: docAId, date: "2020-01-01" },
  });
  check("backdated token rejected (422)", past.status === 422, past.status);

  console.log("\n=====================================");
  console.log("PASS: " + pass + "   FAIL: " + fail);
  console.log("=====================================");
  if (fail > 0) process.exit(1);
}

function todayPlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

main().catch((e) => {
  console.error("\n[SETUP ERROR]", e && e.stack ? e.stack : e);
  process.exit(1);
});
