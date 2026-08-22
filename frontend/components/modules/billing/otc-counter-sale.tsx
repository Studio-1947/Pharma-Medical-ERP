"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Pill,
  Package,
  AlertTriangle,
  CheckCircle2,
  Receipt,
  Gift,
  IndianRupee,
  Camera,
  FileCheck,
  ShieldCheck,
  Search,
  Plus,
  X,
  ArrowLeft,
  ShoppingCart,
  UserRound,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { apiClient, queryKeys } from "@/lib/api-client";
import { useActiveBranchId } from "@/hooks/use-branch";
import { useDebounce } from "@/hooks/use-debounce";
import { usePermissions } from "@/hooks/use-permissions";
import { formatStockUnit, getUnitLabel } from "@/lib/stock-unit-formatter";
import { isValidPhoneNumber } from "@/lib/phone-validation";
import { quoteOtcSaleLines } from "@/lib/otc-quote";
import { scheduleLabel } from "@/lib/schedule-class";
import { invalidateMedicineViews } from "@/lib/query-invalidation";
import { useAuthStore } from "@/stores/auth.store";
import { RxPickerModal } from "./rx-picker-modal";
import { InvoiceDetailModal } from "./invoice-detail-modal";
import { Modal } from "@/components/ui/modal";

/**
 * OTC counter supply — medicines handed over without a prescription.
 *
 * Two paths, because a pharmacy does both and they are not the same event:
 *
 *  - "Bill it" (the default): the customer pays. This is a sale like any
 *    other, so it goes through the normal invoice route — server-side FEFO,
 *    price from the batch, per-line discount, GST split, payment mode,
 *    invoice number, timestamp. Without a bill the money never reached the
 *    day-end tally, the GST return or the cash reconciliation, and the stock
 *    left the shelf with no revenue recorded against it.
 *
 *  - "Free / no charge": genuine samples, staff medicine, counter hand-outs.
 *    No money changes hands, so no bill is issued; stock is decremented and
 *    an `otc_supply` ledger movement records what left and why.
 *
 * A walk-in rarely buys one thing, so the sale is laid out the way the counter
 * actually works it: search on the left, the growing bill on the right, both in
 * one viewport. Everything on the right goes out as a single invoice — one
 * bill, one payment, one invoice number.
 *
 * Rendered inline on the counter desk (`variant="inline"`) and inside the POS
 * terminal's dialog (`variant="modal"`, via OtcSupplyModal), so there is one
 * implementation of the sale and two places it can appear.
 */

export type OtcMedicine = {
  id: string;
  name: string;
  sku?: string | null;
  priceMrp?: string | number | null;
  taxPercent?: string | number | null;
  stripSize?: string | number | null;
  unit?: string | null;
  dosageForm?: string | null;
  scheduleClass?: string | null;
  requiresPrescription?: boolean | null;
};

/** One medicine on the counter sale, with how much of it is going out. */
type OtcLine = {
  medicine: OtcMedicine;
  saleUnit: "pack" | "loose";
  quantity: number;
  discountPct: number;
  /** Free hand-outs come off one named batch; a billed sale is FEFO'd server-side. */
  batchId: string;
};

function inr(n: number) {
  return `₹${n.toFixed(2)}`;
}

function newLine(medicine: OtcMedicine): OtcLine {
  return { medicine, saleUnit: "pack", quantity: 1, discountPct: 0, batchId: "" };
}

/** Phone numbers are typed with spaces, hyphens and a country code as often as not. */
function digitsOf(phone: string) {
  return phone.replace(/\D/g, "");
}

/** Same number, however it was written down — compare on the last ten digits. */
function samePhone(a: string, b: string) {
  const x = digitsOf(a);
  const y = digitsOf(b);
  return x.length >= 10 && y.length >= 10 && x.slice(-10) === y.slice(-10);
}

function asArray(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.data?.data)) return raw.data.data;
  if (Array.isArray(raw?.data)) return raw.data;
  return [];
}

export function OtcCounterSale({
  medicine,
  onClose,
  variant = "inline",
}: {
  medicine: OtcMedicine | null;
  onClose: () => void;
  /** "inline" draws its own header; inside a dialog the Modal supplies one. */
  variant?: "inline" | "modal";
}) {
  const qc = useQueryClient();
  const { branchId: activeBranchId } = useActiveBranchId();
  const { success: toastSuccess, error: toastError } = useToast();
  const { can, role } = usePermissions();
  const currentUserId = useAuthStore((st) => st.user?.id ?? null);

  const canBill = can("billing.create");
  const canGiveFree = can("inventory.adjust");

  const [lines, setLines] = useState<OtcLine[]>([]);
  const [mode, setMode] = useState<"bill" | "free">("bill");
  // "credit" is the counter's due sale: the medicines go out now and the money
  // is collected later. It is the only mode that needs a name and a number,
  // because a debt with nobody's name on it cannot be chased.
  const [paymentMode, setPaymentMode] = useState<"cash" | "upi" | "card" | "credit">("cash");
  const [referenceNo, setReferenceNo] = useState("");
  // Who owes it. Kept out of the walk-in path entirely — these are only read
  // when the sale is on credit, and only then are they required.
  const [dueName, setDueName] = useState("");
  const [duePhone, setDuePhone] = useState("");
  /**
   * The registered patient this due is pinned to, once the operator has picked
   * one from the lookup.
   *
   * The submit path already matched on phone and attached the due to an
   * existing account, but it did so silently and only on an exact number. That
   * left the operator typing blind: a returning customer whose number they did
   * not have to hand was invisible, and there was no way to tell before
   * billing whether this would join an account or open a second one. Picking
   * here makes that choice explicit and survives a misspelt name.
   */
  const [duePatientId, setDuePatientId] = useState<string | null>(null);
  const [duePatientLabel, setDuePatientLabel] = useState<string | null>(null);
  /** Part payment taken at the counter against a credit sale. "" = nothing paid now. */
  const [duePaidNow, setDuePaidNow] = useState("");
  const [duePaidMode, setDuePaidMode] = useState<"cash" | "upi" | "card">("cash");
  /** Doctor this counter sale is credited to, when it is one of theirs. */
  const [referredByDoctorId, setReferredByDoctorId] = useState("");
  const [notes, setNotes] = useState("");
  const [billedInvoiceId, setBilledInvoiceId] = useState<string | null>(null);
  // Inactive medicine MRP edit state
  const [inactiveMrpTarget, setInactiveMrpTarget] = useState<any | null>(null);
  const [inactiveMrpValue, setInactiveMrpValue] = useState("");
  const [inactiveMrpLoading, setInactiveMrpLoading] = useState(false);
  const [inactiveMrpError, setInactiveMrpError] = useState<string | null>(null);

  const confirmInactiveMrp = async () => {
    if (!inactiveMrpTarget) return;
    const mrp = parseFloat(inactiveMrpValue);
    if (!mrp || mrp <= 0) {
      setInactiveMrpError("Enter a valid MRP greater than zero.");
      return;
    }
    setInactiveMrpLoading(true);
    setInactiveMrpError(null);
    try {
      await apiClient.patch(`/inventory/medicines/${inactiveMrpTarget.id}`, {
        priceMrp: mrp.toFixed(2),
        isActive: true,
      });
      // The row was just activated. Every cached list still has it as
      // Inactive at the old price, and nothing else will correct them — this
      // is what used to make a manual page refresh necessary.
      await invalidateMedicineViews(qc);
      const patched = { ...inactiveMrpTarget, priceMrp: mrp.toFixed(2), isActive: true };
      setInactiveMrpTarget(null);
      setInactiveMrpValue("");
      toastSuccess("Medicine activated", `"${patched.name}" is now active at MRP ₹${mrp.toFixed(2)}.`);
      addMedicine(patched);
    } catch (err: any) {
      setInactiveMrpError(err?.response?.data?.message ?? "Failed to update MRP. Try again.");
    } finally {
      setInactiveMrpLoading(false);
    }
  };
  const [search, setSearch] = useState("");
  // Schedule H at the counter: either a prescription is attached now, or a
  // manager vouches for one and the bill carries the debt until it arrives.
  // The invoice carries one prescription, so this is a bill-level decision.
  const [prescriptionId, setPrescriptionId] = useState<string | null>(null);
  const [rxLabel, setRxLabel] = useState<string | null>(null);
  const [attested, setAttested] = useState(false);
  const [rxPickerOpen, setRxPickerOpen] = useState(false);

  const open = !!medicine;

  // The host keeps this component mounted between sales, so without this the
  // next medicine opens carrying the last sale's lines, discount and note.
  useEffect(() => {
    setLines(medicine ? [newLine(medicine)] : []);
    setReferenceNo("");
    setPaymentMode("cash");
    setDueName("");
    setDuePhone("");
    // Cleared with the rest: a pin left behind would put the next sale's due
    // on the previous customer's account.
    setDuePatientId(null);
    setDuePatientLabel(null);
    setDuePaidNow("");
    setDuePaidMode("cash");
    setReferredByDoctorId("");
    setNotes("");
    setSearch("");
    setBilledInvoiceId(null);
    setPrescriptionId(null);
    setRxLabel(null);
    setAttested(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [medicine?.id]);

  // One batch query per line — the price, the FEFO preview and the ceiling on
  // the quantity all come from the branch's own shelves.
  const batchQueries = useQueries({
    queries: lines.map((l) => ({
      queryKey: ["otc-supply-batches", l.medicine.id, activeBranchId],
      queryFn: () =>
        apiClient.get(`/inventory/medicines/${l.medicine.id}/batches`, {
          params: { branchId: activeBranchId },
        }) as any,
      enabled: open,
    })),
  });

  /**
   * Everything the UI and the payload need per line, derived from the line's
   * own batches. Plain arithmetic over a handful of rows — cheap enough to run
   * on each keystroke, and memoising it would only fight React Query's fresh
   * array identities.
   */
  const rows = lines.map((line, idx) => {
    const q = batchQueries[idx];
    const batches = asArray(q?.data);
    const stripSize = Math.max(1, Number(line.medicine.stripSize ?? 1) || 1);
    const taxPct = Number(line.medicine.taxPercent ?? 0) || 0;
    // Shape the unit formatters expect — stripSize arrives as a numeric string
    // from the API and would otherwise be compared as text.
    const unitInfo = {
      unit: line.medicine.unit ?? null,
      dosageForm: line.medicine.dosageForm ?? null,
      stripSize,
    };
    const schedule = scheduleLabel(line.medicine.scheduleClass);
    const controlled = !!line.medicine.requiresPrescription || !!schedule;
    // Total sellable across every FEFO batch — the server allocates across
    // batches, so the ceiling is the pooled quantity, not one batch's.
    const totalAvailable = batches.reduce(
      (sum, b) => sum + Math.max(0, Number(b.quantity ?? 0) - Number(b.reservedQty ?? 0)),
      0,
    );
    // Quantity in the unit the invoice API speaks. Mirrors the POS exactly: a
    // pack line is sent as packs x stripSize, because the server prices per
    // loose unit (mrpAtEntry / stripSize).
    const baseUnits = line.saleUnit === "pack" ? line.quantity * stripSize : line.quantity;
    const maxQty =
      line.saleUnit === "pack" ? Math.floor(totalAvailable / stripSize) : totalAvailable;
    const selectedBatch = batches.find((b) => b.id === line.batchId) ?? batches[0] ?? null;
    const freeMax = Number(selectedBatch?.quantity ?? 0);

    return {
      line,
      idx,
      batches,
      loading: !!q?.isLoading,
      stripSize,
      taxPct,
      unitInfo,
      schedule,
      controlled,
      totalAvailable,
      baseUnits,
      maxQty,
      selectedBatch,
      freeMax,
    };
  });

  /**
   * Priced against the batches FEFO will actually pull from, line by line,
   * with the server's per-line rounding — so the amount tendered here is the
   * amount the server computes. A paisa of drift is not cosmetic: the invoice
   * route rejects both over-payment and an under-paid walk-in.
   */
  const quote = quoteOtcSaleLines(
    rows.map((r) => ({
      batches: r.batches,
      units: r.baseUnits,
      discountPct: r.line.discountPct,
      taxPct: r.taxPct,
      stripSize: r.stripSize,
    })),
  );

  const anyControlled = rows.some((r) => r.controlled);
  const scheduleNames = Array.from(
    new Set(rows.filter((r) => r.controlled).map((r) => r.schedule ?? "Prescription")),
  );
  const scheduleWord = scheduleNames.join(" / ") || "Prescription";
  // Vouching puts a named person on the sale, so it is a manager's call. The
  // same three roles the server accepts as an override approver — anyone else
  // would be rejected at checkout, so do not offer them the button.
  const canAttest = ["super_admin", "admin", "shop_manager"].includes(String(role));
  const rxCleared = !anyControlled || !!prescriptionId || attested;

  // Same rule as the POS terminal: the vouching belongs to the bill, not to the
  // screen. Take the last controlled line off this sale and the attestation
  // goes with it, so it can neither be sent on an all-OTC bill (which the
  // server refuses) nor be inherited by a controlled medicine added afterwards
  // that nobody vouched for.
  useEffect(() => {
    if (!anyControlled) setAttested(false);
  }, [anyControlled]);
  const loadingBatches = rows.some((r) => r.loading);

  // ── Credit / due sale ─────────────────────────────────────────────────────
  // The bill is issued in full either way; what changes is how much of it is
  // collected now. Whatever is left becomes the customer's outstanding balance,
  // which the server will only accept against a named patient — hence the two
  // required fields, and hence "find them or register them" before billing.
  const onCredit = paymentMode === "credit";
  const paidNow = Math.min(
    quote.total,
    Math.max(0, Number.parseFloat(duePaidNow) || 0),
  );
  const dueAmount = Number((quote.total - paidNow).toFixed(2));
  // Live lookup over whatever the operator has typed. Either field drives it:
  // they may know the name and not the number, which was the case the
  // phone-only match at submit time could never serve.
  const dueLookupTerm = (duePhone.trim().length >= 3 ? duePhone : dueName).trim();
  const debouncedDueLookup = useDebounce(dueLookupTerm, 300);
  const dueLookupActive = !duePatientId && debouncedDueLookup.length >= 3;
  const { data: dueMatchesRaw, isFetching: dueLookupBusy } = useQuery({
    queryKey: ["otc-due-patient-lookup", debouncedDueLookup],
    queryFn: () =>
      apiClient.get("/patients", {
        params: { search: debouncedDueLookup, limit: 6 },
      }) as any,
    enabled: dueLookupActive,
  });
  const dueMatches: any[] = dueLookupActive ? asArray(dueMatchesRaw) : [];

  /** Pins the due to an existing account and fills the fields from it. */
  const pickDuePatient = (p: any) => {
    setDuePatientId(p.id);
    setDuePatientLabel(`${p.name ?? "Customer"} · ${p.phone ?? ""}`);
    setDueName(p.name ?? "");
    setDuePhone(String(p.phone ?? ""));
  };

  const clearDuePatient = () => {
    setDuePatientId(null);
    setDuePatientLabel(null);
  };

  const duePhoneValid = isValidPhoneNumber(duePhone);
  const creditReady = !onCredit || (dueName.trim().length > 0 && duePhoneValid);
  // A part payment that clears the whole bill is not a credit sale at all — it
  // still bills fine, it just leaves nothing owing.
  const leavesDebt = onCredit && dueAmount > 0;
  // The reference box belongs to whichever tender is actually being taken.
  const refMode = onCredit ? duePaidMode : paymentMode;
  const showReference = onCredit ? paidNow > 0 && duePaidMode !== "cash" : paymentMode !== "cash";

  // One rate on the bill reads better as "GST @ 12%"; a mixed bill cannot claim
  // a single rate, so it just says GST.
  const singleTaxPct =
    rows.length > 0 && rows.every((r) => r.taxPct === rows[0]!.taxPct) ? rows[0]!.taxPct : null;

  const updateLine = (idx: number, patch: Partial<OtcLine>) =>
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const removeLine = (idx: number) =>
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));

  // ── Left pane: find another medicine for the same bill ────────────────────
  const debouncedSearch = useDebounce(search, 300);
  const searchActive = open && debouncedSearch.trim().length >= 2;
  const { data: searchRaw, isFetching: searching } = useQuery({
    queryKey: ["otc-add-medicine-search", debouncedSearch, activeBranchId],
    queryFn: () =>
      apiClient.get("/inventory/medicines", {
        // Raised from 8 for the same reason as the counter desk: a short
        // list filled up with active rows and hid the inactive matches.
        params: { search: debouncedSearch.trim(), limit: 25, isActive: "all" },
      }) as any,
    enabled: searchActive,
  });
  const onBill = new Set(lines.map((l) => l.medicine.id));
  const searchResults: OtcMedicine[] = asArray(searchRaw).filter((m: any) => !onBill.has(m.id));

  const addMedicine = (m: OtcMedicine) => {
    // Inactive medicines cannot be sold — prompt for MRP first.
    if ((m as any).isActive === false) {
      setInactiveMrpTarget(m);
      const mrp = m.priceMrp != null ? String(m.priceMrp) : "";
      setInactiveMrpValue(mrp && parseFloat(mrp) > 0 ? mrp : "");
      setInactiveMrpError(null);
      return;
    }
    setLines((prev) => (prev.some((l) => l.medicine.id === m.id) ? prev : [...prev, newLine(m)]));
    setSearch("");
  };

  // ── Doctor this counter sale belongs to ───────────────────────────────────
  // A walk-in with no paper is often still a doctor's patient: seen upstairs,
  // came down and asked for what they were told to take. Tagging the doctor
  // keeps that sale in their dispensing history instead of losing it to
  // anonymous OTC. It is attribution only — it opens no Schedule H gate.
  //
  // Only offered when no prescription is attached, since one already names its
  // own doctor, and only to the roles the doctors route admits: everyone else
  // would collect a 403 for a field they cannot use.
  const canTagDoctor = ["super_admin", "admin", "shop_manager", "doctor"].includes(
    String(role),
  );
  const { data: doctorsRaw } = useQuery({
    queryKey: ["otc-referring-doctors", activeBranchId],
    queryFn: () =>
      apiClient.get("/clinic/doctors", {
        ...(activeBranchId ? { params: { branchId: activeBranchId } } : {}),
      }) as any,
    enabled: open && mode === "bill" && canTagDoctor,
    staleTime: 5 * 60 * 1000,
  });
  const doctors = asArray(doctorsRaw);
  const doctorName = (d: any) =>
    [d?.firstName, d?.lastName].filter(Boolean).join(" ").trim() || d?.email || "Doctor";
  const taggedDoctor = doctors.find((d: any) => d.id === referredByDoctorId) ?? null;

  const resetAndClose = () => {
    setBilledInvoiceId(null);
    setLines([]);
    setReferenceNo("");
    setPaymentMode("cash");
    setDueName("");
    setDuePhone("");
    // Cleared with the rest: a pin left behind would put the next sale's due
    // on the previous customer's account.
    setDuePatientId(null);
    setDuePatientLabel(null);
    setDuePaidNow("");
    setDuePaidMode("cash");
    setReferredByDoctorId("");
    setNotes("");
    setSearch("");
    onClose();
  };

  /** Whoever is already on file under this number, or null. */
  const findPatientByPhone = async (phone: string): Promise<string | null> => {
    const digits = digitsOf(phone);
    if (digits.length < 10) return null;
    const res: any = await apiClient.get("/patients", {
      params: { search: digits.slice(-10), limit: 10 },
    });
    const match = asArray(res).find((p: any) => samePhone(String(p?.phone ?? ""), phone));
    return match?.id ?? null;
  };

  /**
   * The patient the debt is recorded against, registering them if this is the
   * first time they have bought on credit.
   *
   * Search first rather than create-then-handle-409: a returning customer must
   * end up on their existing account, or their dues would be spread over a new
   * record every visit and nobody would see the real balance.
   */
  const resolveDuePatientId = async (): Promise<string> => {
    // An explicit pick wins over the phone match: the operator has already
    // said which account this belongs to.
    if (duePatientId) return duePatientId;
    const existing = await findPatientByPhone(duePhone);
    if (existing) return existing;
    try {
      const res: any = await apiClient.post("/patients", {
        name: dueName.trim(),
        phone: duePhone.trim(),
      });
      const created = res?.data?.data ?? res?.data ?? res;
      if (created?.id) return created.id;
    } catch (err: any) {
      // 409 means the number was registered between the search and the insert,
      // or under a spelling the search missed — look again rather than fail.
      if (err?.response?.status !== 409) throw err;
    }
    const retry = await findPatientByPhone(duePhone);
    if (retry) return retry;
    throw new Error(
      "Could not put this sale on an account — check the phone number, or register the customer on the Patients screen first.",
    );
  };

  // ── Billed OTC sale — the normal invoice route ────────────────────────────
  const billMutation = useMutation({
    mutationFn: async () => {
      // A due has to belong to someone: the server refuses to leave a balance
      // owing on an anonymous walk-in, so the account is settled before the
      // invoice is written.
      const patientId = onCredit ? await resolveDuePatientId() : null;
      return apiClient.post("/billing/invoices", {
        ...(patientId ? { patientId } : {}),
        branchId: activeBranchId,
        items: rows.map((r) => ({
          medicineId: r.line.medicine.id,
          quantity: r.baseUnits,
          discountPct: r.line.discountPct.toFixed(2),
        })),
        // A credit sale still declares how it was settled. When nothing is paid
        // at the counter that is a single zero-value `credit` entry — the whole
        // bill becomes the customer's outstanding balance. A part payment is
        // sent as the tender that was actually taken, and the server turns the
        // shortfall into the due by itself.
        payments: onCredit
          ? paidNow > 0
            ? [
                {
                  mode: duePaidMode,
                  amount: paidNow.toFixed(2),
                  ...(referenceNo.trim() ? { referenceNo: referenceNo.trim() } : {}),
                },
              ]
            : [{ mode: "credit", amount: "0.00" }]
          : [
              {
                mode: paymentMode,
                amount: quote.total.toFixed(2),
                ...(referenceNo.trim() ? { referenceNo: referenceNo.trim() } : {}),
              },
            ],
        discountAmount: "0",
        ...(prescriptionId ? { prescriptionId } : {}),
        // Attribution only, and only when there is no prescription to carry the
        // doctor already.
        ...(!prescriptionId && referredByDoctorId ? { referredByDoctorId } : {}),
        // Attested sale: the manager's name and reason ride on the existing
        // override fields, and rxPending is what keeps the missing paper
        // visible until someone attaches it.
        //
        // anyControlled is re-checked here as well as in the effect above. A
        // bill with nothing controlled on it has no prescription to owe, and
        // the server refuses rxPending on one outright.
        ...(anyControlled && attested && !prescriptionId
          ? {
              rxPending: true,
              overriddenBy: currentUserId ?? undefined,
              overrideReason: [
                "Manager verified the prescription at the counter; prescription to be attached",
                notes.trim(),
              ]
                .filter(Boolean)
                .join(" · "),
            }
          : {}),
        notes: [
          prescriptionId
            ? "OTC counter sale — prescription attached"
            : attested
              ? "OTC counter sale — prescription attested, still to be attached"
              : "OTC counter sale — no prescription",
          // What the bill itself should say about the money, so the debt is
          // legible on the printed copy the customer walks away with.
          leavesDebt
            ? `On credit — ₹${dueAmount.toFixed(2)} due from ${dueName.trim()} (${duePhone.trim()})`
            : "",
          // On the printed bill too, so the customer's copy says whose
          // medicines these were.
          !prescriptionId && taggedDoctor ? `Doctor: ${doctorName(taggedDoctor)}` : "",
          notes.trim(),
        ]
          .filter(Boolean)
          .join(" · "),
        // Same idempotency guard the POS uses: a retry after a lost response
        // returns the invoice already written instead of billing it twice.
        clientRef: `OTC-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      }) as any;
    },
    onSuccess: (res: any) => {
      const invoice = res?.data?.invoice ?? res?.data?.data ?? res?.data ?? res;
      qc.invalidateQueries({ queryKey: ["otc-supply-batches"] });
      qc.invalidateQueries({ queryKey: ["counter-low-stock"] });
      qc.invalidateQueries({ queryKey: ["counter-served-today"] });
      qc.invalidateQueries({ queryKey: ["medicine-batches-detail"] });
      qc.invalidateQueries({ queryKey: queryKeys.invoices.all() });
      qc.invalidateQueries({ queryKey: queryKeys.medicines.list({}) });
      // A credit sale's outstanding balance shows on the patient and on the
      // receivables list, neither of which would refresh on their own.
      if (onCredit) {
        qc.invalidateQueries({ queryKey: queryKeys.patients.all() });
        qc.invalidateQueries({ queryKey: ["receivables-aging"] });
      }
      const billRef = invoice?.invoiceNo ? `Bill ${invoice.invoiceNo}` : "Bill created";
      const medicineCount = `${lines.length} medicine${lines.length === 1 ? "" : "s"}`;
      toastSuccess(
        leavesDebt ? "OTC sale billed on credit" : "OTC sale billed",
        leavesDebt
          ? `${billRef} — ${medicineCount}, ${inr(dueAmount)} now owed by ${dueName.trim()}${paidNow > 0 ? ` after ${inr(paidNow)} paid by ${duePaidMode.toUpperCase()}` : ""}. Collect it from their outstanding balance.`
          : `${billRef} — ${medicineCount}, ${inr(quote.total)} received by ${refMode.toUpperCase()}.`,
      );
      // The bill itself is the useful thing to look at next — the counter
      // prints or shares it straight from here.
      if (invoice?.id) setBilledInvoiceId(invoice.id);
      else resetAndClose();
    },
    onError: (err: any) => {
      toastError(
        "Sale not completed",
        err?.response?.data?.message ?? "Could not bill this OTC sale.",
      );
    },
  });

  // ── Free hand-out — ledger movement only, no bill ─────────────────────────
  // One call per medicine, because the ledger records a hand-out against a
  // named batch. Sequential and reported line by line: a hand-out that fails
  // half way through must not be reported as if all of it went out.
  const freeMutation = useMutation({
    mutationFn: async () => {
      const done: string[] = [];
      const failed: string[] = [];
      for (const r of rows) {
        const batchId = r.line.batchId || r.selectedBatch?.id;
        if (!batchId) {
          failed.push(r.line.medicine.name);
          continue;
        }
        try {
          await apiClient.post(`/inventory/batches/${batchId}/otc-supply`, {
            quantity: r.line.quantity,
            branchId: activeBranchId,
            notes: notes.trim() || undefined,
          });
          done.push(r.line.medicine.name);
        } catch {
          failed.push(r.line.medicine.name);
        }
      }
      return { done, failed };
    },
    onSuccess: ({ done, failed }) => {
      qc.invalidateQueries({ queryKey: ["otc-supply-batches"] });
      qc.invalidateQueries({ queryKey: ["counter-low-stock"] });
      qc.invalidateQueries({ queryKey: ["counter-otc-today"] });
      qc.invalidateQueries({ queryKey: ["medicine-batches-detail"] });
      qc.invalidateQueries({ queryKey: queryKeys.medicines.list({}) });
      if (done.length > 0) {
        toastSuccess(
          "Free hand-out recorded",
          `${done.join(", ")} given free — stock deducted, no bill.`,
        );
      }
      if (failed.length > 0) {
        toastError(
          "Some hand-outs were not recorded",
          `${failed.join(", ")} could not be handed out. Their stock is unchanged — try again.`,
        );
        return;
      }
      resetAndClose();
    },
    onError: (err: any) => {
      toastError(
        "Hand-out failed",
        err?.response?.data?.message ?? "Could not record the free hand-out.",
      );
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (rows.length === 0) return;
    if (mode === "free") {
      if (anyControlled) return;
      if (rows.some((r) => !r.line.batchId && !r.selectedBatch)) return;
      freeMutation.mutate();
      return;
    }
    if (quote.short > 0 || quote.total <= 0) return;
    if (!rxCleared) return;
    // Nobody's name on the debt, nobody to collect it from.
    if (!creditReady) return;
    billMutation.mutate();
  };

  const pending = billMutation.isPending || freeMutation.isPending;
  const freeBlocked =
    anyControlled ||
    !canGiveFree ||
    rows.length === 0 ||
    rows.some((r) => r.freeMax <= 0 || r.line.quantity > r.freeMax);

  // After a successful sale the bill itself is the useful thing to look at —
  // the counter prints or shares it from here.
  if (billedInvoiceId) {
    return <InvoiceDetailModal invoiceId={billedInvoiceId} onClose={resetAndClose} />;
  }

  // The picker searches verified prescriptions and, on its upload tab,
  // photographs a paper one and files it against a walk-in patient before
  // returning the id — the whole "scan it now" path already existed for the POS.
  if (rxPickerOpen && medicine) {
    return (
      <RxPickerModal
        open
        // Schedule H keeps its full strictness; a customer who simply brought
        // a prescription for an ordinary sale is not asked for the doctor's
        // council number, which they will not have.
        context={anyControlled ? "schedule-h" : "optional"}
        // If the sale is already going on someone's account, the prescription
        // belongs on that same account rather than the shared walk-in record.
        patientId={duePatientId}
        patientName={duePatientId ? dueName.trim() || null : null}
        onClose={() => setRxPickerOpen(false)}
        onSelectRx={(rxId, details) => {
          setPrescriptionId(rxId);
          setRxLabel(details?.doctorName ? `from ${details.doctorName}` : null);
          setAttested(false);
          setRxPickerOpen(false);
        }}
      />
    );
  }

  if (!medicine) return null;

  const heading =
    mode === "free"
      ? "Free hand-out — no bill"
      : anyControlled
        ? `${scheduleWord} sale — prescription required`
        : "OTC sale — no prescription";

  return (
    <div
      className="space-y-4"
      // A half-composed counter sale lives only in this component's state, so
      // the background auto-reload that applies a new app version has to hold
      // off while it is on screen. PwaRegister looks for this attribute; the
      // user is still offered the explicit "Update" prompt.
      data-pharmerp-unsaved={lines.length > 0 ? "otc-counter-sale" : undefined}
    >
      {variant === "inline" && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-9 h-9 rounded-xl bg-orange-100 text-orange-700 flex items-center justify-center shrink-0">
              <Pill size={16} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-800 truncate">{heading}</p>
              <p className="text-xs text-slate-400 truncate">
                Search on the left, bill on the right — add as many medicines as
                the customer is taking.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-slate-200 bg-white text-slate-600 text-xs font-semibold hover:bg-slate-50 transition-colors"
          >
            <ArrowLeft size={13} /> Back to search
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* ══ LEFT — find the medicines ═══════════════════════════════════ */}
        <div className="lg:col-span-5 space-y-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-3.5 space-y-3">
            <label
              htmlFor="otc-add-medicine"
              className="block text-xs font-bold text-slate-700"
            >
              Search medicines
            </label>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                id="otc-add-medicine"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  // Enter inside the sale form would otherwise submit the bill.
                  // On this field it means "take the first match", which is also
                  // what a barcode scanner's trailing Enter should do.
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  const first = searchResults[0];
                  if (first) addMedicine(first);
                }}
                placeholder="Name, SKU or barcode…"
                type="search"
                autoComplete="off"
                className="w-full text-sm border-2 border-slate-200 rounded-xl pl-9 pr-3 py-2.5 bg-white focus:outline-none focus:border-orange-400 focus:ring-4 focus:ring-orange-100 transition-all [&::-webkit-search-cancel-button]:appearance-none"
              />
            </div>

            <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden max-h-[420px] overflow-y-auto">
              {!searchActive && (
                <p className="px-3 py-6 text-center text-xs text-slate-400">
                  Type at least 2 characters to find a medicine, or scan its
                  barcode.
                </p>
              )}
              {searchActive && searching && (
                <p className="px-3 py-2.5 text-xs text-slate-400 animate-pulse">Searching…</p>
              )}
              {searchActive && !searching && searchResults.length === 0 && (
                <p className="px-3 py-6 text-center text-xs text-slate-400">
                  Nothing else matched &ldquo;{debouncedSearch.trim()}&rdquo;.
                </p>
              )}
              {searchActive &&
                searchResults.map((m: any) => {
                  const stock = Number(m.totalStock || 0);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => addMedicine(m)}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-orange-50/60 transition-colors"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-bold text-slate-800 truncate">
                          {m.name}
                          {(m as any).isActive === false && (
                            <span className="ml-1.5 text-[9px] bg-amber-100 text-amber-700 font-extrabold px-1.5 py-0.2 rounded border border-amber-200">
                              Inactive
                            </span>
                          )}
                        </span>
                        <span className="block text-[11px] text-slate-400 font-mono truncate">
                          {m.sku ?? ""}
                          {m.scheduleClass ? ` · ${m.scheduleClass}` : ""}
                        </span>
                      </span>
                      {/* Stock keeps its own column so the add buttons line up
                          down the list instead of shuffling with the length of
                          "Out of stock". */}
                      <span
                        className={`w-20 shrink-0 text-right text-[11px] font-semibold leading-tight ${
                          stock > 0 ? "text-emerald-700" : "text-rose-600"
                        }`}
                      >
                        {formatStockUnit(stock, m)}
                      </span>
                      <span className="w-16 shrink-0 inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-full bg-orange-500 text-white text-[11px] font-bold">
                        <Plus size={11} /> Add
                      </span>
                    </button>
                  );
                })}
            </div>
          </div>
        </div>

        {/* ══ RIGHT — the bill being built ════════════════════════════════ */}
        <div className="lg:col-span-7 space-y-3">
          {/* Mode switch */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!canBill}
              onClick={() => setMode("bill")}
              className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                mode === "bill"
                  ? "bg-orange-500 text-white border-orange-500 shadow-sm"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              }`}
            >
              <Receipt size={14} /> Bill it (customer pays)
            </button>
            <button
              type="button"
              disabled={!canGiveFree}
              onClick={() => {
                setMode("free");
                // A quantity typed in packs would otherwise walk off one batch
                // as if it were that many loose units.
                setLines((prev) =>
                  prev.map((l, i) => ({
                    ...l,
                    saleUnit: "pack",
                    quantity: Math.max(1, Math.min(l.quantity, rows[i]?.freeMax || 1)),
                  })),
                );
              }}
              className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                mode === "free"
                  ? "bg-slate-800 text-white border-slate-800 shadow-sm"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              }`}
            >
              <Gift size={14} /> Free — no charge
            </button>
          </div>

          {mode === "bill" ? (
            <div className="flex items-start gap-2 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
              <Receipt size={14} className="shrink-0 mt-0.5" />
              <span>
                A proper bill is created — quantity, time, price, discount, GST
                and payment mode are all recorded, so this sale appears in the
                day-end tally, the sales report and the GST return.
              </span>
            </div>
          ) : (
            <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>
                No bill and no payment are created — this is money the shop does
                not collect. Stock is deducted and the hand-out is recorded in
                the movement ledger. Use it only for free samples, staff
                medicine and counter give-aways.
              </span>
            </div>
          )}

          {/* Schedule H at the counter. This used to be a dead end — "bill it
              from the POS" — which just moved the problem to another screen and
              taught staff that the OTC desk lies. There are only two honest
              ways past it: produce the prescription, or have a manager put
              their name to having seen it and owe the paper afterwards. */}
          {/* A free hand-out writes no invoice, so there is nothing to attach a
              prescription to and no rxPending flag to carry the debt — the drug
              would simply leave the shelf with a ledger line and no authority
              behind it. Giving a Schedule H medicine away is not a lesser act
              than selling one, so this path is closed for them outright. */}
          {anyControlled && mode === "free" && (
            <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>
                {scheduleWord} cannot be given away as a free hand-out — there
                would be no bill and no prescription on record. Use{" "}
                <strong>Bill it</strong> and either attach the prescription or
                have a manager vouch for it.
              </span>
            </div>
          )}

          {anyControlled && mode === "bill" && (
            <div
              className={`rounded-xl border px-3 py-2.5 space-y-2.5 ${
                rxCleared ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"
              }`}
            >
              {prescriptionId ? (
                <div className="flex items-start gap-2 text-xs text-emerald-800">
                  <FileCheck size={14} className="shrink-0 mt-0.5" />
                  <span>
                    Prescription <strong>{rxLabel ?? "linked"}</strong> is
                    attached to this sale.{" "}
                    <button
                      type="button"
                      onClick={() => {
                        setPrescriptionId(null);
                        setRxLabel(null);
                      }}
                      className="underline font-semibold"
                    >
                      Change
                    </button>
                  </span>
                </div>
              ) : attested ? (
                <div className="flex items-start gap-2 text-xs text-emerald-800">
                  <FileCheck size={14} className="shrink-0 mt-0.5" />
                  <span>
                    You are billing this on your own word that you have seen the
                    prescription. The bill will be flagged as still owing it
                    until someone attaches the prescription.{" "}
                    <button
                      type="button"
                      onClick={() => setAttested(false)}
                      className="underline font-semibold"
                    >
                      Undo
                    </button>
                  </span>
                </div>
              ) : (
                <>
                  <div className="flex items-start gap-2 text-xs text-red-700">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    <span>
                      {scheduleWord} cannot be handed over without a
                      prescription. Attach it, or vouch for it and attach it
                      later.
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setRxPickerOpen(true)}
                      className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors"
                    >
                      <Camera size={14} /> Scan / attach prescription
                    </button>
                    <button
                      type="button"
                      disabled={!canAttest}
                      onClick={() => setAttested(true)}
                      title={
                        canAttest
                          ? "Bill now on your verification, attach the prescription afterwards"
                          : "Only a shop manager or admin can vouch for a prescription"
                      }
                      className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <ShieldCheck size={14} /> I verified it — attach later
                    </button>
                  </div>
                  {!canAttest && (
                    <p className="text-[11px] text-slate-500">
                      Vouching is a manager&apos;s call — your name goes on the
                      sale. Ask a shop manager to sign in, or scan the
                      prescription.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Optional prescription on an ordinary counter sale.
              
              The scan-and-attach path already existed but only appeared when
              something on the bill was Schedule H, where it is compulsory. A
              customer often brings a prescription for medicines that do not
              legally require one, and there was no way to put it on the bill
              — the paper went home with them and the sale carried no record
              of why those medicines were sold. Optional here, and quiet: it
              must not read as a demand on a plain OTC sale. */}
          {!anyControlled && mode === "bill" && (
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
              {prescriptionId ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-start gap-2 text-xs text-emerald-800 min-w-0">
                    <FileCheck size={14} className="shrink-0 mt-0.5" />
                    <span>
                      Prescription <strong>{rxLabel ?? "linked"}</strong> is
                      attached to this sale.
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setPrescriptionId(null);
                      setRxLabel(null);
                    }}
                    className="shrink-0 text-[11px] font-bold text-slate-500 hover:text-red-600 underline underline-offset-2"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-slate-500 min-w-0">
                    Customer brought a prescription?{" "}
                    <span className="text-slate-400">
                      Optional — it is filed against the bill.
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setRxPickerOpen(true)}
                    className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-[11px] font-bold transition-colors"
                  >
                    <Camera size={13} /> Scan / upload prescription
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Lines on this sale */}
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-3.5 py-2 border-b border-slate-100 bg-slate-50/70 flex items-center justify-between gap-2">
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <ShoppingCart size={12} /> On this{" "}
                {mode === "free" ? "hand-out" : "bill"}
              </p>
              <span className="text-[10px] font-bold text-slate-400">
                {lines.length} medicine{lines.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="p-3 space-y-3 max-h-[460px] overflow-y-auto">
              {rows.length === 0 && (
                <p className="py-6 text-center text-xs text-slate-400">
                  Nothing added yet — search on the left.
                </p>
              )}
              {rows.map((r) => {
                const unitLabel = getUnitLabel(r.line.quantity, r.unitInfo);
                const lineQuote = quote.lines[r.idx];
                const outOfStock = !r.loading && r.totalAvailable <= 0;

                return (
                  <div
                    key={r.line.medicine.id}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-3 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">
                          {r.line.medicine.name}
                        </p>
                        <p className="text-[11px] text-slate-400 font-mono truncate">
                          {r.line.medicine.sku ?? ""}
                          {r.schedule ? ` · ${r.schedule}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm font-black text-slate-900">
                          {mode === "bill" ? inr(lineQuote?.total ?? 0) : "No charge"}
                        </span>
                        {lines.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeLine(r.idx)}
                            title={`Remove ${r.line.medicine.name} from this sale`}
                            aria-label={`Remove ${r.line.medicine.name}`}
                            className="w-6 h-6 rounded-full border border-slate-200 text-slate-400 hover:text-rose-600 hover:border-rose-200 flex items-center justify-center transition-colors"
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>
                    </div>

                    {r.loading ? (
                      <p className="text-xs text-slate-400 animate-pulse">Loading active batches…</p>
                    ) : outOfStock ? (
                      <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-2">
                        <Package size={13} className="shrink-0 mt-0.5" />
                        <span>
                          No active stock in this branch. Receive stock for this
                          medicine, or remove it from the sale.
                        </span>
                      </div>
                    ) : mode === "free" ? (
                      /* Batch picker — a free hand-out comes off one named batch */
                      <div>
                        <label
                          htmlFor={`otc-batch-${r.line.medicine.id}`}
                          className="block text-xs font-bold text-slate-700 mb-1.5"
                        >
                          Batch (FEFO order — earliest expiry first)
                        </label>
                        <select
                          id={`otc-batch-${r.line.medicine.id}`}
                          value={r.line.batchId || r.selectedBatch?.id || ""}
                          onChange={(e) => updateLine(r.idx, { batchId: e.target.value })}
                          required
                          className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/30"
                        >
                          {r.batches.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.batchNo} — {formatStockUnit(Number(b.quantity ?? 0), r.unitInfo)}
                              {b.expiryDate ? ` · exp ${b.expiryDate.slice(0, 7)}` : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      /* Billed sale: the server picks batches by FEFO, splitting
                         across them when one runs short — show what it will pull. */
                      <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                          Batches used (FEFO — earliest expiry first)
                        </p>
                        {!lineQuote || lineQuote.used.length === 0 ? (
                          <p className="text-xs text-slate-500 mt-1">
                            Enter a quantity to see which batch is pulled.
                          </p>
                        ) : (
                          <ul className="mt-1 space-y-0.5">
                            {lineQuote.used.map((u) => (
                              <li key={u.batchNo} className="text-xs text-slate-700 font-medium">
                                {u.batchNo} — {u.units} unit{u.units === 1 ? "" : "s"}
                                {u.expiryDate ? ` · exp ${u.expiryDate.slice(0, 7)}` : ""}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}

                    {!r.loading && !outOfStock && (
                      <>
                        {/* Sale unit — only meaningful when a pack holds more than one */}
                        {mode === "bill" && r.stripSize > 1 && (
                          <div>
                            <p
                              id={`otc-saleunit-label-${r.line.medicine.id}`}
                              className="block text-xs font-bold text-slate-700 mb-1.5"
                            >
                              Sold as
                            </p>
                            <div
                              className="grid grid-cols-2 gap-2"
                              role="group"
                              aria-labelledby={`otc-saleunit-label-${r.line.medicine.id}`}
                            >
                              {(["pack", "loose"] as const).map((u) => (
                                <button
                                  key={u}
                                  type="button"
                                  onClick={() => {
                                    // A quantity typed in loose units would
                                    // otherwise become that many full packs.
                                    const cap =
                                      u === "pack"
                                        ? Math.floor(r.totalAvailable / r.stripSize)
                                        : r.totalAvailable;
                                    updateLine(r.idx, {
                                      saleUnit: u,
                                      quantity: Math.max(1, Math.min(r.line.quantity, cap || 1)),
                                    });
                                  }}
                                  className={`px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${
                                    r.line.saleUnit === u
                                      ? "bg-slate-800 text-white border-slate-800"
                                      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                                  }`}
                                >
                                  {u === "pack"
                                    ? `Full ${getUnitLabel(1, r.unitInfo)} (${r.stripSize})`
                                    : "Loose units"}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Quantity + discount */}
                        <div className={mode === "bill" ? "grid grid-cols-2 gap-3" : ""}>
                          <div>
                            <label
                              htmlFor={`otc-quantity-${r.line.medicine.id}`}
                              className="block text-xs font-bold text-slate-700 mb-1.5"
                            >
                              Quantity {mode === "bill" ? `(${unitLabel})` : "to supply"}
                            </label>
                            <input
                              id={`otc-quantity-${r.line.medicine.id}`}
                              type="number"
                              min={1}
                              max={(mode === "free" ? r.freeMax : r.maxQty) || undefined}
                              value={r.line.quantity}
                              onChange={(e) => {
                                const cap = mode === "free" ? r.freeMax : r.maxQty;
                                updateLine(r.idx, {
                                  quantity: Math.min(
                                    cap || 1,
                                    Math.max(1, Number(e.target.value) || 1),
                                  ),
                                });
                              }}
                              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/30"
                            />
                            <p className="mt-1 text-[11px] text-slate-400">
                              Max {mode === "free" ? r.freeMax : r.maxQty} on{" "}
                              {mode === "free" ? "this batch" : "hand"}
                            </p>
                          </div>

                          {mode === "bill" && (
                            <div>
                              <label
                                htmlFor={`otc-discount-${r.line.medicine.id}`}
                                className="block text-xs font-bold text-slate-700 mb-1.5"
                              >
                                Discount %
                              </label>
                              <input
                                id={`otc-discount-${r.line.medicine.id}`}
                                type="number"
                                min={0}
                                max={100}
                                step="0.01"
                                value={r.line.discountPct}
                                onChange={(e) =>
                                  updateLine(r.idx, {
                                    discountPct: Math.min(
                                      100,
                                      Math.max(0, Number(e.target.value) || 0),
                                    ),
                                  })
                                }
                                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/30"
                              />
                              <p className="mt-1 text-[11px] text-slate-400">
                                Comes off before GST is worked out
                              </p>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {mode === "bill" && (
            <>
              {/* Whose sale this is, clinically */}
              {canTagDoctor && !prescriptionId && doctors.length > 0 && (
                <div>
                  <label
                    htmlFor="otc-referring-doctor"
                    className="block text-xs font-bold text-slate-700 mb-1.5"
                  >
                    Doctor <span className="font-normal text-slate-400">(optional)</span>
                  </label>
                  <select
                    id="otc-referring-doctor"
                    value={referredByDoctorId}
                    onChange={(e) => setReferredByDoctorId(e.target.value)}
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/30"
                  >
                    <option value="">No doctor — plain counter sale</option>
                    {doctors.map((d: any) => (
                      <option key={d.id} value={d.id}>
                        {doctorName(d)}
                        {d.doctorProfile?.specialty ? ` · ${d.doctorProfile.specialty}` : ""}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Tags this sale to the doctor it came from, so it shows in their
                    history. It is not a prescription and does not clear a Schedule
                    H medicine.
                  </p>
                </div>
              )}

              {/* Payment */}
              <div>
                <p id="otc-payment-label" className="block text-xs font-bold text-slate-700 mb-1.5">
                  Payment received by
                </p>
                <div
                  className="grid grid-cols-2 sm:grid-cols-4 gap-2"
                  role="group"
                  aria-labelledby="otc-payment-label"
                >
                  {(["cash", "upi", "card", "credit"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPaymentMode(m)}
                      className={`px-3 py-2 rounded-lg text-xs font-bold uppercase border transition-colors ${
                        paymentMode === m
                          ? m === "credit"
                            ? "bg-amber-600 text-white border-amber-600"
                            : "bg-emerald-600 text-white border-emerald-600"
                          : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      {m === "credit" ? "Due / Credit" : m}
                    </button>
                  ))}
                </div>
              </div>

              {/* Who owes it — only asked for on a credit sale */}
              {onCredit && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-3 space-y-3">
                  <div className="flex items-start gap-2">
                    <UserRound size={14} className="text-amber-700 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-amber-900 leading-snug">
                      Nothing is collected now — the medicines go out and the amount
                      is recorded against this customer&apos;s account. A name and a
                      working phone number are required, because a due with nobody&apos;s
                      name on it cannot be collected later. If they are already
                      registered under this number, the amount is added to that
                      account instead of creating a second one.
                    </p>
                  </div>

                  {/* Pinned to a registered account. Shown instead of the
                      lookup so it is unambiguous which one the due lands on. */}
                  {duePatientId && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                      <p className="text-xs font-semibold text-emerald-900 min-w-0">
                        Adding to the account of{" "}
                        <span className="font-black">{duePatientLabel}</span>
                      </p>
                      <button
                        type="button"
                        onClick={clearDuePatient}
                        className="shrink-0 text-[11px] font-bold text-emerald-700 hover:text-emerald-900 underline underline-offset-2"
                      >
                        Use a different customer
                      </button>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor="otc-due-name"
                        className="block text-xs font-bold text-slate-700 mb-1.5"
                      >
                        Customer name <span className="text-red-600">*</span>
                      </label>
                      <input
                        id="otc-due-name"
                        value={dueName}
                        onChange={(e) => {
                          setDueName(e.target.value);
                          // Typing over a pinned account means it is no longer
                          // that customer. Keeping the pin would put the due on
                          // whoever was picked while the form showed a name
                          // that is not theirs.
                          clearDuePatient();
                        }}
                        placeholder="e.g. Ramesh Das"
                        autoComplete="off"
                        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="otc-due-phone"
                        className="block text-xs font-bold text-slate-700 mb-1.5"
                      >
                        Phone number <span className="text-red-600">*</span>
                      </label>
                      <input
                        id="otc-due-phone"
                        value={duePhone}
                        onChange={(e) => {
                          setDuePhone(e.target.value);
                          clearDuePatient();
                        }}
                        placeholder="10-digit mobile number"
                        inputMode="tel"
                        autoComplete="off"
                        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                      />
                      {duePhone.trim().length > 0 && !duePhoneValid && (
                        <p className="mt-1 text-[11px] font-semibold text-red-600">
                          Enter a valid 10-digit mobile number.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Who this might already be. Matching on name as well as
                      number is the point: the number is exactly what an
                      operator does not have when a regular walks back in. */}
                  {dueLookupActive && (
                    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                      {dueLookupBusy && dueMatches.length === 0 && (
                        <p className="px-3 py-2 text-[11px] text-slate-400 animate-pulse">
                          Looking for an existing customer…
                        </p>
                      )}
                      {!dueLookupBusy && dueMatches.length === 0 && (
                        <p className="px-3 py-2 text-[11px] text-slate-500">
                          No existing customer matches. This sale will register{" "}
                          <span className="font-bold">{dueName.trim() || "them"}</span> as a
                          new one.
                        </p>
                      )}
                      {dueMatches.length > 0 && (
                        <>
                          <p className="px-3 py-1.5 bg-slate-50 border-b border-slate-100 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                            Already registered
                          </p>
                          <div className="divide-y divide-slate-100 max-h-52 overflow-y-auto">
                            {dueMatches.map((p: any) => {
                              const owes = Number(p.outstandingBalance ?? 0);
                              return (
                                <button
                                  key={p.id}
                                  type="button"
                                  onClick={() => pickDuePatient(p)}
                                  className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-emerald-50/70 transition-colors"
                                >
                                  <span className="min-w-0">
                                    <span className="block text-xs font-bold text-slate-800 truncate">
                                      {p.name}
                                    </span>
                                    <span className="block text-[11px] font-mono text-slate-400 truncate">
                                      {p.phone}
                                    </span>
                                  </span>
                                  {/* What they already owe belongs on a credit
                                      decision, not two screens away. */}
                                  <span
                                    className={`shrink-0 text-[11px] font-bold ${
                                      owes > 0 ? "text-rose-600" : "text-slate-400"
                                    }`}
                                  >
                                    {owes > 0 ? `owes ${inr(owes)}` : "no dues"}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* Part payment — "due" is often "paid some of it now" */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor="otc-due-paid-now"
                        className="block text-xs font-bold text-slate-700 mb-1.5"
                      >
                        Paying now{" "}
                        <span className="font-normal text-slate-400">(optional)</span>
                      </label>
                      <input
                        id="otc-due-paid-now"
                        type="number"
                        min={0}
                        max={quote.total}
                        step="0.01"
                        value={duePaidNow}
                        onChange={(e) => setDuePaidNow(e.target.value)}
                        placeholder="0.00"
                        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                      />
                      <p className="mt-1 text-[11px] text-slate-500">
                        Leave blank if the whole bill is on credit
                      </p>
                    </div>
                    {paidNow > 0 && (
                      <div>
                        <p
                          id="otc-due-paid-mode-label"
                          className="block text-xs font-bold text-slate-700 mb-1.5"
                        >
                          Part payment taken by
                        </p>
                        <div
                          className="grid grid-cols-3 gap-2"
                          role="group"
                          aria-labelledby="otc-due-paid-mode-label"
                        >
                          {(["cash", "upi", "card"] as const).map((m) => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => setDuePaidMode(m)}
                              className={`px-2 py-2 rounded-lg text-[11px] font-bold uppercase border transition-colors ${
                                duePaidMode === m
                                  ? "bg-emerald-600 text-white border-emerald-600"
                                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                              }`}
                            >
                              {m}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {showReference && (
                <div>
                  <label
                    htmlFor="otc-reference"
                    className="block text-xs font-bold text-slate-700 mb-1.5"
                  >
                    Reference no <span className="font-normal text-slate-400">(optional)</span>
                  </label>
                  <input
                    id="otc-reference"
                    value={referenceNo}
                    onChange={(e) => setReferenceNo(e.target.value)}
                    placeholder={refMode === "upi" ? "UPI transaction ID" : "Card last 4 digits"}
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/30"
                  />
                </div>
              )}

              {/* Amount */}
              <div
                className={`rounded-xl border px-3 py-2.5 space-y-1 ${
                  leavesDebt
                    ? "border-amber-200 bg-amber-50/70"
                    : "border-emerald-200 bg-emerald-50/60"
                }`}
              >
                <div className="flex justify-between text-xs text-slate-600">
                  <span>
                    Taxable value
                    {rows.some((r) => r.line.discountPct > 0) ? " (after discount)" : ""}
                  </span>
                  <span className="font-semibold">{inr(quote.subtotal)}</span>
                </div>
                <div className="flex justify-between text-xs text-slate-600">
                  <span>GST{singleTaxPct !== null ? ` @ ${singleTaxPct}%` : ""}</span>
                  <span className="font-semibold">{inr(quote.tax)}</span>
                </div>
                <div
                  className={`flex justify-between text-sm font-extrabold pt-1 border-t ${
                    leavesDebt
                      ? "text-amber-900 border-amber-200"
                      : "text-emerald-800 border-emerald-200"
                  }`}
                >
                  <span className="flex items-center gap-1">
                    <IndianRupee size={13} /> {onCredit ? "Bill total" : "To collect"}
                    {lines.length > 1 ? ` (${lines.length} medicines)` : ""}
                  </span>
                  <span>{inr(quote.total)}</span>
                </div>
                {onCredit && (
                  <>
                    <div className="flex justify-between text-xs text-slate-600 pt-1">
                      <span>Collected now</span>
                      <span className="font-semibold">{inr(paidNow)}</span>
                    </div>
                    <div className="flex justify-between text-sm font-extrabold text-amber-900">
                      <span>Goes on the customer&apos;s account</span>
                      <span>{inr(dueAmount)}</span>
                    </div>
                  </>
                )}
              </div>

              {onCredit && !creditReady && (
                <p className="text-xs font-semibold text-amber-700">
                  Enter the customer&apos;s name and phone number before billing this
                  sale on credit.
                </p>
              )}

              {quote.short > 0 && (
                <p className="text-xs font-semibold text-red-600">
                  Not enough stock — {quote.short} more unit
                  {quote.short === 1 ? "" : "s"} needed than the branch holds.
                </p>
              )}
            </>
          )}

          {/* Notes */}
          <div>
            <label htmlFor="otc-notes" className="block text-xs font-bold text-slate-700 mb-1.5">
              {leavesDebt ? "Note for this due" : "Notes"}{" "}
              <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input
              id="otc-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                mode === "free"
                  ? "e.g. free sample, staff medicine, counter hand-out…"
                  : leavesDebt
                    ? "e.g. regular customer, will settle on Friday…"
                    : "e.g. walk-in customer, phone order…"
              }
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/30"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                pending ||
                loadingBatches ||
                (mode === "bill"
                  ? !rxCleared ||
                    !canBill ||
                    !creditReady ||
                    quote.short > 0 ||
                    quote.total <= 0
                  : freeBlocked)
              }
              className={`flex items-center gap-2 px-5 py-2 text-white text-xs font-extrabold rounded-lg disabled:opacity-50 transition-colors shadow-sm ${
                mode === "bill"
                  ? leavesDebt
                    ? "bg-amber-600 hover:bg-amber-700"
                    : "bg-emerald-600 hover:bg-emerald-700"
                  : "bg-slate-800 hover:bg-slate-900"
              }`}
            >
              {pending ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {mode === "bill" ? "Billing…" : "Recording…"}
                </>
              ) : mode === "bill" ? (
                <>
                  <Receipt size={14} />
                  {leavesDebt
                    ? `Bill ${inr(quote.total)} — ${inr(dueAmount)} on account`
                    : `Bill ${inr(quote.total)}`}
                </>
              ) : (
                <>
                  <CheckCircle2 size={14} />
                  Record Free Hand-out
                </>
              )}
            </button>
          </div>
        </div>
      </form>

      {/* Inactive medicine MRP edit — set price and reactivate before adding */}
      <Modal
        title="Set MRP & Activate"
        subtitle={inactiveMrpTarget ? `"${inactiveMrpTarget.name}" is currently inactive — enter its MRP to make it sellable.` : undefined}
        open={!!inactiveMrpTarget}
        onClose={() => { setInactiveMrpTarget(null); setInactiveMrpValue(""); setInactiveMrpError(null); }}
        size="sm"
      >
        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-muted-foreground">
            This medicine has no MRP set, so it cannot be sold. Enter the MRP below to activate it and add it to the bill.
          </p>
          <div className="space-y-1">
            <label className="text-sm font-semibold">MRP (INR) <span className="text-red-500">*</span></label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">₹</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={inactiveMrpValue}
                onChange={(e) => { setInactiveMrpValue(e.target.value); setInactiveMrpError(null); }}
                placeholder="e.g. 85.50"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter" && inactiveMrpValue && !inactiveMrpLoading) confirmInactiveMrp(); }}
                className="w-full border rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
              />
            </div>
          </div>
          {inactiveMrpError && (
            <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {inactiveMrpError}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => { setInactiveMrpTarget(null); setInactiveMrpValue(""); setInactiveMrpError(null); }}
              className="px-4 py-2 border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={confirmInactiveMrp}
              disabled={!inactiveMrpValue || inactiveMrpLoading}
              className="flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              {inactiveMrpLoading ? (
                <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Activating…</>
              ) : (
                <>Set MRP & Add to Bill</>
              )}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
