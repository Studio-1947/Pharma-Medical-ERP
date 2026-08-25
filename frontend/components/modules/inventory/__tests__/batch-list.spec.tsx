import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * The batches tab. Three things a shelf of 45,000 batches made unworkable:
 *
 *  - it could not be searched, so reaching the batch named on a recall notice
 *    meant paging;
 *  - Add Stock read branchId off the JWT. A super_admin has none, so every
 *    attempt came back "super_admin must select a branch" even with a branch
 *    showing in the switcher;
 *  - cost price was mandatory, which held stock off the shelf whenever the
 *    supplier invoice had not arrived yet.
 */

const get = vi.fn();
const post = vi.fn();
const del = vi.fn();

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    patch: vi.fn(),
    delete: (...a: unknown[]) => del(...a),
  },
  queryKeys: { medicines: { list: () => ["medicines", "list"] } },
}));

let branchState = { branchId: "branch-1" as string | undefined, needsSelection: false };
vi.mock("@/hooks/use-branch", () => ({
  useActiveBranchId: () => branchState,
}));

vi.mock("@/stores/auth.store", () => ({
  useAuthStore: () => ({ user: { id: "u1", role: "super_admin", branchId: null } }),
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
}));

vi.mock("@/hooks/use-barcode-scanner", () => ({ useBarcodeScanner: () => {} }));
vi.mock("@/components/shared/barcode-scanner-dialog", () => ({ BarcodeScannerDialog: () => null }));
vi.mock("../barcode-label-modal", () => ({ BarcodeLabelModal: () => null }));

import { BatchList } from "../batch-list";

const MEDICINE = {
  id: "22222222-2222-2222-2222-222222222222",
  name: "Duphalac 10 g/15 ml Solution",
  sku: "MED02024",
  priceMrp: "383.94",
};

const BATCH = {
  id: "b-1",
  medicineId: MEDICINE.id,
  medicineName: "Gestofit 100 mg Softgel Capsule",
  batchNo: "DA32636",
  expiryDate: "2026-01-28",
  quantity: 67,
  costPrice: "173.69",
  mrpAtEntry: "206.41",
  status: "expired",
};

/** Captures the params of the last GET against the batches list endpoint. */
function lastBatchListParams(): Record<string, unknown> | undefined {
  const calls = get.mock.calls.filter(
    (c: any[]) => c[0] === "/inventory/batches" && !c[1]?.params?.medicineId,
  );
  return calls.at(-1)?.[1]?.params;
}

beforeEach(() => {
  vi.clearAllMocks();
  branchState = { branchId: "branch-1", needsSelection: false };
  get.mockImplementation((url: string, cfg: any) => {
    if (url === "/inventory/medicines") {
      return Promise.resolve({ data: [MEDICINE] });
    }
    return Promise.resolve({ data: [BATCH], meta: { page: 1, limit: 20, total: 45, totalPages: 3 } });
  });
  post.mockResolvedValue({ data: { id: "batch-new" } });
});

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <BatchList />
    </QueryClientProvider>,
  );
}

describe("BatchList — search", () => {
  it("sends what was typed to the server as a search filter", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText("DA32636");

    await user.type(screen.getByLabelText("Search batches"), "gestofit");

    await waitFor(
      () => expect(lastBatchListParams()?.search).toBe("gestofit"),
      { timeout: 3000 },
    );
  });

  it("searches on the batch number too — what a recall notice names", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText("DA32636");

    await user.type(screen.getByLabelText("Search batches"), "DA32636");

    await waitFor(
      () => expect(lastBatchListParams()?.search).toBe("DA32636"),
      { timeout: 3000 },
    );
  });

  it("goes back to page one when the search narrows, so results are not skipped past", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText("DA32636");

    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(lastBatchListParams()?.page).toBe(2));

    await user.type(screen.getByLabelText("Search batches"), "gest");

    await waitFor(
      () => expect(lastBatchListParams()?.page).toBe(1),
      { timeout: 3000 },
    );
  });

  it("sends no search key at all when the box is empty", async () => {
    renderList();
    await screen.findByText("DA32636");
    expect(lastBatchListParams()).not.toHaveProperty("search");
  });
});

describe("BatchList — Add Stock", () => {
  async function openFormWithMedicine(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: /Add Stock/i }));
    await user.type(screen.getByPlaceholderText(/Type name, SKU/i), "duph");
    await user.click(await screen.findByRole("button", { name: /Duphalac/i }));
    await user.type(screen.getByPlaceholderText("e.g. B2024001"), "0088");
    const expiry = document.querySelector('input[type="date"]') as HTMLInputElement;
    await user.type(expiry, "2027-12-01");
    await user.type(screen.getByPlaceholderText("100"), "100");
  }

  /** "Add Stock" names the toolbar button, the modal title and submit — scope it. */
  const submit = () =>
    within(document.querySelector("form")!).getByRole("button", { name: /Add Stock/i });

  it("posts the branch from the switcher, not the (empty) one on the JWT", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText("DA32636");

    await openFormWithMedicine(user);
    await user.click(submit());

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]![1]).toMatchObject({ branchId: "branch-1" });
  });

  it("receives stock with no cost price, leaving the server to cost it", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText("DA32636");

    await openFormWithMedicine(user);
    await user.click(submit());

    await waitFor(() => expect(post).toHaveBeenCalled());
    const payload = post.mock.calls[0]![1];
    // Absent, not "0.00": a zero would be written straight into stock
    // valuation, where the server's purchase-rate fallback cannot reach it.
    expect(payload).not.toHaveProperty("costPrice");
    expect(payload).toMatchObject({ quantity: 100, mrpAtEntry: "383.94" });
  });

  it("still sends a cost price the operator typed", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText("DA32636");

    await openFormWithMedicine(user);
    await user.type(screen.getByPlaceholderText(/Leave blank if unknown/i), "300");
    await user.click(submit());

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]![1]).toMatchObject({ costPrice: "300.00" });
  });

  it("says which branch is missing instead of letting the server say it", async () => {
    branchState = { branchId: undefined, needsSelection: true };
    const user = userEvent.setup();
    renderList();
    await screen.findByText("DA32636");

    await openFormWithMedicine(user);
    await user.click(submit());

    expect(await screen.findByText(/Select a branch in the top bar/i)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });
});
