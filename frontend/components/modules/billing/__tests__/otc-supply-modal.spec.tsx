import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Wiring test for the OTC counter-sale modal.
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
  usePermissions: () => ({ can, role: "admin" }),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: toastSuccess, error: toastError }),
}));

vi.mock("../invoice-detail-modal", () => ({
  InvoiceDetailModal: ({ invoiceId }: { invoiceId: string }) => (
    <div data-testid="invoice-detail">{invoiceId}</div>
  ),
}));

import { OtcSupplyModal } from "../otc-supply-modal";

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

beforeEach(() => {
  vi.clearAllMocks();
  can.mockImplementation(() => true);
  get.mockResolvedValue({ data: BATCHES });
  post.mockResolvedValue({ data: { invoice: { id: "inv-9", invoiceNo: "BRN01-1" } } });
});

describe("OtcSupplyModal", () => {
  it("bills the sale by default and tenders exactly the amount it displays", async () => {
    const user = userEvent.setup();
    renderModal();

    // One strip of 10 at 85.50 pre-tax + 12% GST.
    const button = await screen.findByRole("button", { name: /Bill ₹95\.76/ });
    expect(screen.getByText("₹95.76")).toBeInTheDocument();

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

  it("refuses to sell a prescription-only medicine over the counter", async () => {
    renderModal({ ...MEDICINE, requiresPrescription: true, scheduleClass: "H" });

    expect(
      await screen.findByText(/needs a verified prescription/i),
    ).toBeInTheDocument();
    const button = await screen.findByRole("button", { name: /Bill ₹/ });
    expect(button).toBeDisabled();
  });

  it("blocks a Schedule H1 medicine even if the prescription flag is missing", async () => {
    // The imported catalogue writes "H1", not "SCHEDULE_H1". Matching only the
    // seed's spelling left this gate resting on requiresPrescription alone.
    renderModal({ ...MEDICINE, requiresPrescription: false, scheduleClass: "H1" });

    expect(
      await screen.findByText(/Schedule H1 needs a verified prescription/i),
    ).toBeInTheDocument();
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

  it("hides billing from a user without the billing permission", async () => {
    can.mockImplementation((p: string) => p !== "billing.create");
    renderModal();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Bill it \(customer pays\)/ })).toBeDisabled(),
    );
  });
});
