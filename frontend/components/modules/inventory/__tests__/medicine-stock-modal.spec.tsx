import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * The direct-receive form on the stock modal. Two things are checked, both of
 * them reachable from the counter desk now that an out-of-stock search row
 * opens this modal:
 *
 *  - autoOpenAddStock lands straight in the form, and closing puts it away so
 *    the next medicine never inherits a half-typed batch;
 *  - the batch is costed from the medicine's purchase rate. There is no cost
 *    input on the form, so this value is the only thing standing between the
 *    received batch and a zero-cost row in stock valuation.
 */

const get = vi.fn();
const post = vi.fn();

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
  },
  queryKeys: { medicines: { list: () => ["medicines", "list"] } },
}));

vi.mock("@/hooks/use-branch", () => ({
  useActiveBranchId: () => ({ branchId: "branch-1" }),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: toastSuccess, error: toastError }),
}));

vi.mock("../barcode-label-modal", () => ({
  BarcodeLabelModal: () => null,
}));

import { MedicineStockModal } from "../medicine-stock-modal";

const MEDICINE = {
  id: "med-1",
  name: "Paracetamol 500mg",
  sku: "MED-001",
  priceMrp: "85.50",
  // The column is purchase_rate — a batch received here is costed from it.
  purchaseRate: "40.00",
  reorderLevel: 10,
};

function stubApi() {
  get.mockImplementation((url: string) => {
    if (url.endsWith("/batches")) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: MEDICINE });
  });
  post.mockResolvedValue({ data: { id: "batch-new" } });
}

function renderModal(props: Partial<React.ComponentProps<typeof MedicineStockModal>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MedicineStockModal
        open
        onClose={vi.fn()}
        medicineId="med-1"
        medicineName="Paracetamol 500mg"
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe("medicine stock modal — direct receive", () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    stubApi();
  });

  it("stays on the batch list when opened the normal way", async () => {
    renderModal();
    await waitFor(() => expect(screen.getByText(/Active Batches/i)).toBeInTheDocument());
    expect(screen.queryByLabelText?.("Batch No *")).toBeFalsy();
    expect(screen.queryByPlaceholderText("e.g. BATCH-992")).not.toBeInTheDocument();
  });

  it("opens straight into the receive form when the counter asks for it", async () => {
    renderModal({ autoOpenAddStock: true });
    expect(await screen.findByPlaceholderText("e.g. BATCH-992")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirm Receive Stock/i })).toBeInTheDocument();
  });

  it("costs the received batch from the medicine's purchase rate", async () => {
    renderModal({ autoOpenAddStock: true });

    const batchNo = await screen.findByPlaceholderText("e.g. BATCH-992");
    await userEvent.type(batchNo, "bat-77");

    const expiry = document.querySelector('input[type="date"]') as HTMLInputElement;
    await userEvent.type(expiry, "2027-10-31");

    await userEvent.click(screen.getByRole("button", { name: /Confirm Receive Stock/i }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/inventory/batches", {
      medicineId: "med-1",
      branchId: "branch-1",
      batchNo: "BAT-77",
      expiryDate: "2027-10-31",
      quantity: 50,
      // Reading medicine.purchasePrice — a field that does not exist on the
      // record — used to send "0.00" here for every direct receive.
      costPrice: "40.00",
      mrpAtEntry: "85.50",
    });
  });

  it("puts the form away on close so the next medicine starts clean", async () => {
    const { rerender } = renderModal({ autoOpenAddStock: true });
    const batchNo = await screen.findByPlaceholderText("e.g. BATCH-992");
    await userEvent.type(batchNo, "half-typed");

    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    rerender(
      <QueryClientProvider client={client}>
        <MedicineStockModal open={false} onClose={vi.fn()} medicineId="med-1" autoOpenAddStock />
      </QueryClientProvider>,
    );
    rerender(
      <QueryClientProvider client={client}>
        <MedicineStockModal open onClose={vi.fn()} medicineId="med-2" autoOpenAddStock />
      </QueryClientProvider>,
    );

    const reopened = await screen.findByPlaceholderText("e.g. BATCH-992");
    expect(reopened).toHaveValue("");
  });
});
