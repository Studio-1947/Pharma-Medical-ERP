import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Wiring test for the OTC counter sale — inline on the counter desk, and in
 * the dialog the POS terminal opens over the till.
 *
 * The arithmetic is covered by lib/__tests__/otc-quote.spec.ts and proved
 * against the server in the backend parity suite; what is checked here is that
 * the screen sends what it displays — the same total it shows the customer, the
 * quantity converted to the unit the invoice API speaks, the discount, and the
 * payment mode — and that the free hand-out path never reaches the billing
 * route.
 */

const post = vi.fn();
const get = vi.fn();

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
  },
  queryKeys: {
    invoices: { all: () => ["invoices"] },
    medicines: { list: () => ["medicines", "list"] },
  },
}));

vi.mock("@/hooks/use-branch", () => ({
  useActiveBranchId: () => ({ branchId: "branch-1" }),
}));

const can = vi.fn((_permission: string) => true);
vi.mock("@/hooks/use-permissions", () => ({
  usePermissions: () => ({ can, role: mockRole }),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: toastSuccess, error: toastError }),
}));

let mockRole = "admin";
vi.mock("@/stores/auth.store", () => ({
  useAuthStore: (selector: any) =>
    selector({ user: { id: "mgr-1", role: mockRole } }),
}));

// Stubbed so a test can hand back a prescription id the way the real picker
// does once the counter has photographed or found the paper.
vi.mock("../rx-picker-modal", () => ({
  RxPickerModal: ({ onSelectRx }: { onSelectRx: (id: string, d?: any) => void }) => (
    <button type="button" onClick={() => onSelectRx("rx-77", { doctorName: "Dr Rao" })}>
      pick-rx
    </button>
  ),
}));

vi.mock("../invoice-detail-modal", () => ({
  InvoiceDetailModal: ({ invoiceId }: { invoiceId: string }) => (
    <div data-testid="invoice-detail">{invoiceId}</div>
  ),
}));

import { OtcSupplyModal } from "../otc-supply-modal";
import { OtcCounterSale } from "../otc-counter-sale";

const BATCHES = [
  {
    id: "batch-near",
    batchNo: "NEAR01",
    quantity: 40,
    reservedQty: 0,
    mrpAtEntry: "85.50",
    expiryDate: "2026-10-31",
  },
  {
    id: "batch-fresh",
    batchNo: "FRESH01",
    quantity: 200,
    reservedQty: 0,
    mrpAtEntry: "85.50",
    expiryDate: "2027-10-31",
  },
];

const MEDICINE = {
  id: "med-1",
  name: "Paracetamol 500 mg",
  sku: "PARA500",
  priceMrp: "85.50",
  taxPercent: "12",
  stripSize: "10",
  unit: "Strip",
  dosageForm: "Tablet",
  scheduleClass: null,
  requiresPrescription: false,
};

function renderModal(medicine: any = MEDICINE) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OtcSupplyModal medicine={medicine} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

/** A second medicine the counter can add to the same bill. */
const MEDICINE_2 = {
  id: "med-2",
  name: "Cetirizine 10 mg",
  sku: "CET10",
  priceMrp: "40.00",
  taxPercent: "12",
  stripSize: "10",
  unit: "Strip",
  dosageForm: "Tablet",
  scheduleClass: null,
  requiresPrescription: false,
};

const BATCHES_2 = [
  {
    id: "batch-cet",
    batchNo: "CET01",
    quantity: 100,
    reservedQty: 0,
    mrpAtEntry: "40.00",
    expiryDate: "2027-01-31",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockRole = "admin";
  can.mockImplementation(() => true);
  // Batches are fetched per medicine, and the catalogue search shares the same
  // client — answer by URL so a two-medicine bill prices each line correctly.
  get.mockImplementation((url: string) => {
    if (url === "/inventory/medicines") return Promise.resolve({ data: [MEDICINE_2] });
    if (url === "/clinic/doctors") return Promise.resolve({ data: DOCTORS });
    // Nobody on file under the number by default, so a credit sale registers
    // the customer; the "already a patient" test overrides this.
    if (url === "/patients") return Promise.resolve({ data: [] });
    if (url.includes("med-2")) return Promise.resolve({ data: BATCHES_2 });
    return Promise.resolve({ data: BATCHES });
  });
  post.mockResolvedValue({ data: { invoice: { id: "inv-9", invoiceNo: "BRN01-1" } } });
});

const DOCTORS = [
  {
    id: "doc-1",
    firstName: "Asha",
    lastName: "Rao",
    doctorProfile: { specialty: "Physician" },
  },
];

/** Registering the walk-in, then billing them — two different POSTs. */
function postByUrl(patient: any = { id: "pat-9", name: "Ramesh Das", phone: "9876543210" }) {
  post.mockImplementation((url: string) =>
    url === "/patients"
      ? Promise.resolve({ data: patient })
      : Promise.resolve({ data: { invoice: { id: "inv-9", invoiceNo: "BRN01-1" } } }),
  );
}

/** Fill in who owes it and hand back nothing at the counter. */
async function takeOnCredit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Due \/ Credit/i }));
  await user.type(screen.getByLabelText(/Customer name/i), "Ramesh Das");
  await user.type(screen.getByLabelText(/Phone number/i), "9876543210");
}

describe("OTC counter sale", () => {
  it("bills the sale by default and tenders exactly the amount it displays", async () => {
    const user = userEvent.setup();
    renderModal();

    // One strip of 10 at 85.50 pre-tax + 12% GST.
    const button = await screen.findByRole("button", { name: /Bill ₹95\.76/ });
    // Once on the medicine's own line, once as the amount to collect — the
    // sale carries a list now, so a line and the bill total both show it.
    expect(screen.getAllByText("₹95.76").length).toBeGreaterThan(0);

    await user.click(button);

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [url, payload] = post.mock.calls[0] as [string, any];
    expect(url).toBe("/billing/invoices");
    expect(payload.branchId).toBe("branch-1");
    // Quantity reaches the API in loose units — one strip of ten.
    expect(payload.items).toEqual([
      { medicineId: "med-1", quantity: 10, discountPct: "0.00" },
    ]);
    expect(payload.payments).toEqual([{ mode: "cash", amount: "95.76" }]);
    expect(payload.notes).toContain("OTC counter sale");
    expect(payload.clientRef).toMatch(/^OTC-\d+-[A-Z0-9]{5}$/);
  });

  it("shows the bill after a successful sale", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(await screen.findByRole("button", { name: /Bill ₹/ }));
    expect(await screen.findByTestId("invoice-detail")).toHaveTextContent("inv-9");
  });

  it("carries the discount into the payload and re-prices before GST", async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByRole("button", { name: /Bill ₹/ });

    const discount = screen.getByLabelText(/Discount %/i, { selector: "input" });
    await user.clear(discount);
    await user.type(discount, "10");

    // 85.50 less 10% = 76.95 taxable, GST 9.23, total 86.18.
    const button = await screen.findByRole("button", { name: /Bill ₹86\.18/ });
    await user.click(button);

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [, payload] = post.mock.calls[0] as [string, any];
    expect(payload.items[0].discountPct).toBe("10.00");
    expect(payload.payments[0].amount).toBe("86.18");
  });

  it("records a UPI reference against the payment", async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByRole("button", { name: /Bill ₹/ });

    await user.click(screen.getByRole("button", { name: "upi" }));
    await user.type(screen.getByPlaceholderText(/UPI transaction ID/i), "UPI-77");
    await user.click(screen.getByRole("button", { name: /Bill ₹/ }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [, payload] = post.mock.calls[0] as [string, any];
    expect(payload.payments[0]).toMatchObject({ mode: "upi", referenceNo: "UPI-77" });
  });

  it("keeps a free hand-out off the billing route entirely", async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByRole("button", { name: /Bill ₹/ });

    await user.click(screen.getByRole("button", { name: /Free — no charge/ }));
    await user.click(screen.getByRole("button", { name: /Record Free Hand-out/ }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [url, payload] = post.mock.calls[0] as [string, any];
    expect(url).toBe("/inventory/batches/batch-near/otc-supply");
    expect(payload).toMatchObject({ quantity: 1, branchId: "branch-1" });
    expect(url).not.toContain("invoices");
  });

  it("will not bill a prescription-only medicine until the prescription is settled", async () => {
    renderModal({ ...MEDICINE, requiresPrescription: true, scheduleClass: "H" });

    expect(
      await screen.findByText(/cannot be handed over without a prescription/i),
    ).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Bill ₹/ })).toBeDisabled();
    // Both ways out are offered rather than sending staff to another screen.
    expect(screen.getByRole("button", { name: /Scan \/ attach prescription/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /I verified it/i })).toBeEnabled();
  });

  it("bills on a manager's attestation and flags the bill as owing the prescription", async () => {
    const user = userEvent.setup();
    renderModal({ ...MEDICINE, requiresPrescription: true, scheduleClass: "H" });

    await user.click(await screen.findByRole("button", { name: /I verified it/i }));
    const bill = await screen.findByRole("button", { name: /Bill ₹/ });
    expect(bill).toBeEnabled();
    await user.click(bill);

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [, payload] = post.mock.calls[0] as [string, any];
    expect(payload.rxPending).toBe(true);
    expect(payload.overriddenBy).toBe("mgr-1");
    expect(payload.overrideReason).toMatch(/verified the prescription/i);
    expect(payload.prescriptionId).toBeUndefined();
  });

  it("bills against a prescription attached at the counter, with no debt left behind", async () => {
    const user = userEvent.setup();
    renderModal({ ...MEDICINE, requiresPrescription: true, scheduleClass: "H" });

    await user.click(await screen.findByRole("button", { name: /Scan \/ attach prescription/i }));
    await user.click(await screen.findByRole("button", { name: "pick-rx" }));

    expect(await screen.findByText(/from Dr Rao/i)).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /Bill ₹/ }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [, payload] = post.mock.calls[0] as [string, any];
    expect(payload.prescriptionId).toBe("rx-77");
    expect(payload.rxPending).toBeUndefined();
  });

  it("will not give a prescription-only medicine away for free", async () => {
    const user = userEvent.setup();
    renderModal({ ...MEDICINE, requiresPrescription: true, scheduleClass: "H" });

    await user.click(await screen.findByRole("button", { name: /Free — no charge/ }));

    expect(await screen.findByText(/cannot be given away as a free hand-out/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Record Free Hand-out/ })).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });

  it("does not let a non-manager vouch for a prescription", async () => {
    mockRole = "cashier";
    renderModal({ ...MEDICINE, requiresPrescription: true, scheduleClass: "H" });

    expect(await screen.findByRole("button", { name: /I verified it/i })).toBeDisabled();
    // Scanning the paper is still open to them — that needs no authority.
    expect(screen.getByRole("button", { name: /Scan \/ attach prescription/i })).toBeEnabled();
  });

  it("blocks a Schedule H1 medicine even if the prescription flag is missing", async () => {
    // The imported catalogue writes "H1", not "SCHEDULE_H1". Matching only the
    // seed's spelling left this gate resting on requiresPrescription alone.
    renderModal({ ...MEDICINE, requiresPrescription: false, scheduleClass: "H1" });

    expect(await screen.findByText(/Schedule H1 cannot be handed over/i)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Bill ₹/ })).toBeDisabled();
  });

  it("caps the quantity at what the branch actually holds", async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByRole("button", { name: /Bill ₹/ });

    const qty = screen.getByLabelText(/^Quantity/i, { selector: "input" });
    await user.clear(qty);
    await user.type(qty, "999");

    // 240 loose units / strip of 10 = 24 full strips available.
    expect((qty as HTMLInputElement).value).toBe("24");
  });

  it("bills several medicines on one invoice, with one payment for the lot", async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByRole("button", { name: /Bill ₹95\.76/ });

    // A walk-in rarely buys one thing — the second medicine joins the same bill.
    await user.type(screen.getByLabelText(/Search medicines/i), "cet");
    await user.click(await screen.findByRole("button", { name: /Cetirizine 10 mg/ }));

    // 85.50 + 12% = 95.76, 40.00 + 12% = 44.80 — one bill of 140.56.
    const bill = await screen.findByRole("button", { name: /Bill ₹140\.56/ });
    await user.click(bill);

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [url, payload] = post.mock.calls[0] as [string, any];
    expect(url).toBe("/billing/invoices");
    expect(payload.items).toEqual([
      { medicineId: "med-1", quantity: 10, discountPct: "0.00" },
      { medicineId: "med-2", quantity: 10, discountPct: "0.00" },
    ]);
    // One invoice, one payment — not one bill per medicine.
    expect(payload.payments).toEqual([{ mode: "cash", amount: "140.56" }]);
  });

  it("prices each medicine's quantity and discount on its own line", async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByRole("button", { name: /Bill ₹/ });

    await user.type(screen.getByLabelText(/Search medicines/i), "cet");
    await user.click(await screen.findByRole("button", { name: /Cetirizine 10 mg/ }));

    // Two strips of the second medicine at 10% off: 80.00 less 8 = 72 taxable,
    // GST 8.64, so 80.64 on top of the first line's 95.76.
    // Set outright rather than clear-and-type: the field re-fills itself with
    // 1 the moment it is emptied, so typing would append to that.
    const qtys = await screen.findAllByLabelText(/^Quantity/i, { selector: "input" });
    fireEvent.change(qtys[1]!, { target: { value: "2" } });
    const discounts = screen.getAllByLabelText(/Discount %/i, { selector: "input" });
    fireEvent.change(discounts[1]!, { target: { value: "10" } });

    await user.click(await screen.findByRole("button", { name: /Bill ₹176\.40/ }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [, payload] = post.mock.calls[0] as [string, any];
    expect(payload.items).toEqual([
      { medicineId: "med-1", quantity: 10, discountPct: "0.00" },
      { medicineId: "med-2", quantity: 20, discountPct: "10.00" },
    ]);
    expect(payload.payments[0].amount).toBe("176.40");
  });

  it("drops a medicine back off the bill without disturbing the rest", async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByRole("button", { name: /Bill ₹95\.76/ });

    await user.type(screen.getByLabelText(/Search medicines/i), "cet");
    await user.click(await screen.findByRole("button", { name: /Cetirizine 10 mg/ }));
    await screen.findByRole("button", { name: /Bill ₹140\.56/ });

    await user.click(screen.getByRole("button", { name: /Remove Cetirizine 10 mg/i }));

    expect(await screen.findByRole("button", { name: /Bill ₹95\.76/ })).toBeEnabled();
  });

  it("holds the whole bill back when any medicine on it needs a prescription", async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByRole("button", { name: /Bill ₹95\.76/ });

    get.mockImplementation((url: string) => {
      if (url === "/inventory/medicines")
        return Promise.resolve({
          data: [{ ...MEDICINE_2, scheduleClass: "H", requiresPrescription: true }],
        });
      if (url.includes("med-2")) return Promise.resolve({ data: BATCHES_2 });
      return Promise.resolve({ data: BATCHES });
    });

    await user.type(screen.getByLabelText(/Search medicines/i), "cet");
    await user.click(await screen.findByRole("button", { name: /Cetirizine 10 mg/ }));

    expect(
      await screen.findByText(/cannot be handed over without a prescription/i),
    ).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Bill ₹/ })).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });

  it("drops the attestation when the medicine it was given for leaves the bill", async () => {
    // The vouching belongs to the bill, not to the screen. Left standing, it
    // rode out on a bill with nothing controlled on it and the server threw the
    // sale out: "Nothing on this bill needs a prescription, so there is none to
    // attach later" — with no Rx panel left on screen to undo it.
    const user = userEvent.setup();
    renderModal();
    await screen.findByRole("button", { name: /Bill ₹95\.76/ });

    get.mockImplementation((url: string) => {
      if (url === "/inventory/medicines")
        return Promise.resolve({
          data: [{ ...MEDICINE_2, scheduleClass: "H", requiresPrescription: true }],
        });
      if (url.includes("med-2")) return Promise.resolve({ data: BATCHES_2 });
      return Promise.resolve({ data: BATCHES });
    });

    await user.type(screen.getByLabelText(/Search medicines/i), "cet");
    await user.click(await screen.findByRole("button", { name: /Cetirizine 10 mg/ }));
    await user.click(await screen.findByRole("button", { name: /I verified it/i }));
    await screen.findByText(/on your own word that you have seen the prescription/i);

    await user.click(screen.getByRole("button", { name: /Remove Cetirizine 10 mg/i }));

    // Paracetamol on its own owes nobody a prescription, and the panel that
    // said otherwise is gone with it.
    await waitFor(() =>
      expect(
        screen.queryByText(/on your own word that you have seen the prescription/i),
      ).not.toBeInTheDocument(),
    );

    await user.click(await screen.findByRole("button", { name: /Bill ₹95\.76/ }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [, payload] = post.mock.calls[0] as [string, any];
    expect(payload.items).toEqual([
      { medicineId: "med-1", quantity: 10, discountPct: "0.00" },
    ]);
    expect(payload.rxPending).toBeUndefined();
    expect(payload.overriddenBy).toBeUndefined();
    expect(payload.overrideReason).toBeUndefined();
    expect(payload.notes).not.toMatch(/attested/i);
  });

  it("makes a manager vouch again for a controlled medicine added after the first one left", async () => {
    // Otherwise the attestation for one Schedule H drug is inherited by the
    // next one, and the bill claims a manager saw a prescription for a medicine
    // nobody ever showed them.
    const user = userEvent.setup();
    renderModal();
    await screen.findByRole("button", { name: /Bill ₹95\.76/ });

    const controlled = (id: string, name: string) => ({
      ...MEDICINE_2,
      id,
      name,
      scheduleClass: "H",
      requiresPrescription: true,
    });

    get.mockImplementation((url: string) => {
      if (url === "/inventory/medicines")
        return Promise.resolve({ data: [controlled("med-2", "Cetirizine 10 mg")] });
      if (url.includes("med-2")) return Promise.resolve({ data: BATCHES_2 });
      return Promise.resolve({ data: BATCHES });
    });

    await user.type(screen.getByLabelText(/Search medicines/i), "cet");
    await user.click(await screen.findByRole("button", { name: /Cetirizine 10 mg/ }));
    await user.click(await screen.findByRole("button", { name: /I verified it/i }));
    await screen.findByText(/on your own word that you have seen the prescription/i);

    await user.click(screen.getByRole("button", { name: /Remove Cetirizine 10 mg/i }));

    // A different controlled drug now joins the same bill.
    get.mockImplementation((url: string) => {
      if (url === "/inventory/medicines")
        return Promise.resolve({ data: [controlled("med-3", "Alprazolam 0.25 mg")] });
      if (url.includes("med-3")) return Promise.resolve({ data: BATCHES_2 });
      return Promise.resolve({ data: BATCHES });
    });

    await user.clear(screen.getByLabelText(/Search medicines/i));
    await user.type(screen.getByLabelText(/Search medicines/i), "alp");
    await user.click(await screen.findByRole("button", { name: /Alprazolam 0\.25 mg/ }));

    // Back to square one: the bill is held until someone vouches for this drug.
    expect(
      await screen.findByText(/cannot be handed over without a prescription/i),
    ).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Bill ₹/ })).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });

  it("runs inline on the counter desk with no dialog around it", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <OtcCounterSale medicine={MEDICINE} onClose={onClose} variant="inline" />
      </QueryClientProvider>,
    );

    // Search on the left, the bill on the right, both on the desk itself.
    expect(await screen.findByLabelText(/Search medicines/i)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Bill ₹95\.76/ })).toBeEnabled();
    expect(screen.getByText(/On this bill/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Back to search/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("marks a half-built bill as unsaved work so a background update waits", async () => {
    // PwaRegister auto-applies a pending app version on a tab that has been
    // hidden for a minute. These lines live only in component state, so without
    // this marker that reload would quietly throw the bill away.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={qc}>
        <OtcCounterSale medicine={MEDICINE} onClose={vi.fn()} variant="inline" />
      </QueryClientProvider>,
    );

    await screen.findByLabelText(/Search medicines/i);
    expect(
      container.querySelector("[data-pharmerp-unsaved]"),
    ).toBeInTheDocument();
  });

  // ── Credit / due sales ───────────────────────────────────────────────────
  //
  // The counter hands the medicines over and collects later. The server will
  // only carry a balance against a named patient, so the two fields are the
  // feature, not decoration.

  it("puts the whole bill on the customer's account when taken on credit", async () => {
    const user = userEvent.setup();
    postByUrl();
    renderModal();
    await screen.findByRole("button", { name: /Bill ₹95\.76/ });

    await takeOnCredit(user);
    await user.click(await screen.findByRole("button", { name: /on account/i }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    // The walk-in is registered first — a due needs an account to sit on.
    const [patientUrl, patientBody] = post.mock.calls[0] as [string, any];
    expect(patientUrl).toBe("/patients");
    expect(patientBody).toMatchObject({ name: "Ramesh Das", phone: "9876543210" });

    const [invoiceUrl, payload] = post.mock.calls[1] as [string, any];
    expect(invoiceUrl).toBe("/billing/invoices");
    expect(payload.patientId).toBe("pat-9");
    // Nothing collected: one zero-value credit entry, which the server turns
    // into a full outstanding balance rather than a receipt.
    expect(payload.payments).toEqual([{ mode: "credit", amount: "0.00" }]);
    expect(payload.notes).toMatch(/On credit .* ₹95\.76 due from Ramesh Das/);
  });

  it("will not bill on credit until the customer is named and reachable", async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByRole("button", { name: /Bill ₹/ });

    await user.click(screen.getByRole("button", { name: /Due \/ Credit/i }));
    expect(await screen.findByRole("button", { name: /on account/i })).toBeDisabled();

    await user.type(screen.getByLabelText(/Customer name/i), "Ramesh Das");
    // A short number is no more collectable than no number at all.
    await user.type(screen.getByLabelText(/Phone number/i), "98765");
    expect(screen.getByRole("button", { name: /on account/i })).toBeDisabled();

    await user.type(screen.getByLabelText(/Phone number/i), "43210");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /on account/i })).toBeEnabled(),
    );
    expect(post).not.toHaveBeenCalled();
  });

  it("adds the due to an existing account instead of registering a second one", async () => {
    const user = userEvent.setup();
    postByUrl();
    get.mockImplementation((url: string) => {
      if (url === "/patients")
        // Same person, number written with a country code and a space.
        return Promise.resolve({
          data: [{ id: "pat-existing", name: "Ramesh Das", phone: "+91 98765 43210" }],
        });
      if (url === "/inventory/medicines") return Promise.resolve({ data: [MEDICINE_2] });
      if (url === "/clinic/doctors") return Promise.resolve({ data: DOCTORS });
      if (url.includes("med-2")) return Promise.resolve({ data: BATCHES_2 });
      return Promise.resolve({ data: BATCHES });
    });
    renderModal();
    await screen.findByRole("button", { name: /Bill ₹/ });

    await takeOnCredit(user);
    await user.click(await screen.findByRole("button", { name: /on account/i }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [url, payload] = post.mock.calls[0] as [string, any];
    expect(url).toBe("/billing/invoices");
    expect(payload.patientId).toBe("pat-existing");
    // A second record would split this customer's dues across two accounts.
    expect(post.mock.calls.some(([u]: [string]) => u === "/patients")).toBe(false);
  });

  it("sends only the part payment actually taken at the counter", async () => {
    const user = userEvent.setup();
    postByUrl();
    renderModal();
    await screen.findByRole("button", { name: /Bill ₹95\.76/ });

    await takeOnCredit(user);
    fireEvent.change(screen.getByLabelText(/Paying now/i), { target: { value: "50" } });
    // The tender for the part payment, not the mode of the sale as a whole.
    const partPayment = await screen.findByRole("group", { name: /Part payment taken by/i });
    await user.click(within(partPayment).getByRole("button", { name: "upi" }));

    // 95.76 billed, 50.00 tendered, 45.76 owed.
    const bill = await screen.findByRole("button", { name: /₹45\.76 on account/ });
    await user.click(bill);

    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    const [, payload] = post.mock.calls[1] as [string, any];
    expect(payload.payments).toEqual([{ mode: "upi", amount: "50.00" }]);
  });

  // ── Doctor attribution ───────────────────────────────────────────────────

  it("tags an untagged counter sale to the doctor it came from", async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByRole("button", { name: /Bill ₹/ });

    await user.selectOptions(await screen.findByLabelText(/^Doctor/i), "doc-1");
    await user.click(screen.getByRole("button", { name: /Bill ₹/ }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [, payload] = post.mock.calls[0] as [string, any];
    expect(payload.referredByDoctorId).toBe("doc-1");
    // Attribution, not authorisation — the bill still carries no prescription.
    expect(payload.prescriptionId).toBeUndefined();
    expect(payload.notes).toMatch(/Doctor: Asha Rao/);
  });

  it("drops the doctor tag once a prescription is attached, since that names one", async () => {
    const user = userEvent.setup();
    renderModal({ ...MEDICINE, requiresPrescription: true, scheduleClass: "H" });

    await user.click(await screen.findByRole("button", { name: /Scan \/ attach prescription/i }));
    await user.click(await screen.findByRole("button", { name: "pick-rx" }));

    expect(screen.queryByLabelText(/^Doctor/i)).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /Bill ₹/ }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [, payload] = post.mock.calls[0] as [string, any];
    expect(payload.prescriptionId).toBe("rx-77");
    expect(payload.referredByDoctorId).toBeUndefined();
  });

  it("hides billing from a user without the billing permission", async () => {
    can.mockImplementation((p: string) => p !== "billing.create");
    renderModal();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Bill it \(customer pays\)/ })).toBeDisabled(),
    );
  });
});
