import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Mapping each medicine to the drawer it physically sits in.
 *
 * The column and the form field already existed, but the list neither showed
 * a drawer nor let one be set, and the API did not return the column at all.
 * Mapping a catalogue of thousands through the full edit modal, one medicine
 * at a time, is not something anybody would finish — the point is to walk the
 * shelves and type as you go, so the edit is inline and saves on Enter or
 * blur.
 */

const get = vi.fn();
const patch = vi.fn();

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    get: (...a: unknown[]) => get(...a),
    post: vi.fn(),
    patch: (...a: unknown[]) => patch(...a),
    delete: vi.fn(),
  },
  queryKeys: {
    medicines: { all: () => ["medicines"], list: (p: object) => ["medicines", "list", p] },
  },
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/hooks/use-branch", () => ({
  useActiveBranchId: () => ({ branchId: "branch-1" }),
}));

vi.mock("@/stores/auth.store", () => ({
  useAuthStore: (selector?: any) => {
    const state = { user: { id: "u1", role: "admin" } };
    return selector ? selector(state) : state;
  },
}));

// Heavy children this list composes; none of them are what is under test.
vi.mock("../medicine-form", () => ({ MedicineForm: () => null }));
vi.mock("../medicine-stock-modal", () => ({ MedicineStockModal: () => null }));
vi.mock("../bulk-import-modal", () => ({ BulkImportModal: () => null }));
vi.mock("../purge-inactive-modal", () => ({ PurgeInactiveModal: () => null }));
vi.mock("@/components/shared/barcode-scanner-dialog", () => ({
  BarcodeScannerDialog: () => null,
}));

import { MedicineList } from "../medicine-list";

const MAPPED = {
  id: "med-1",
  name: "Dolo 650",
  sku: "MED-001",
  priceMrp: "30.00",
  unit: "strip",
  requiresPrescription: false,
  isControlled: false,
  isActive: true,
  drawerMapping: "A3",
};

const UNMAPPED = { ...MAPPED, id: "med-2", name: "Pan 40", sku: "MED-002", drawerMapping: null };

function stub(medicines: any[]) {
  get.mockImplementation(() =>
    Promise.resolve({ data: medicines, meta: { total: medicines.length, totalPages: 1 } }),
  );
  patch.mockResolvedValue({ data: { ok: true } });
}

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MedicineList />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  patch.mockReset();
});

describe("mapping medicines to drawers from the inventory list", () => {
  it("shows the drawer a medicine is in, and offers to set one where it is not", async () => {
    stub([MAPPED, UNMAPPED]);
    renderList();

    expect(await screen.findByRole("button", { name: /Drawer for Dolo 650/i })).toHaveTextContent("A3");
    // An unmapped row has to invite the mapping, not render blank.
    expect(screen.getByRole("button", { name: /Drawer for Pan 40/i })).toHaveTextContent("Set");
  });

  it("saves a drawer typed straight into the row", async () => {
    const user = userEvent.setup();
    stub([UNMAPPED]);
    renderList();

    await user.click(await screen.findByRole("button", { name: /Drawer for Pan 40/i }));
    await user.type(screen.getByLabelText(/Drawer for Pan 40/i), "B7{Enter}");

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith("/inventory/medicines/med-2", { drawerMapping: "B7" });
  });

  it("writes nothing when the drawer was not actually changed", async () => {
    const user = userEvent.setup();
    stub([MAPPED]);
    renderList();

    await user.click(await screen.findByRole("button", { name: /Drawer for Dolo 650/i }));
    // Clicking through a row while walking the shelves must not write.
    await user.tab();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Drawer for Dolo 650/i })).toBeInTheDocument(),
    );
    expect(patch).not.toHaveBeenCalled();
  });

  it("abandons the edit on Escape", async () => {
    const user = userEvent.setup();
    stub([MAPPED]);
    renderList();

    await user.click(await screen.findByRole("button", { name: /Drawer for Dolo 650/i }));
    const input = screen.getByLabelText(/Drawer for Dolo 650/i);
    await user.clear(input);
    await user.type(input, "ZZ{Escape}");

    expect(patch).not.toHaveBeenCalled();
  });

  it("asks the server for one drawer when the filter is used", async () => {
    const user = userEvent.setup();
    stub([MAPPED]);
    renderList();
    await screen.findByRole("button", { name: /Drawer for Dolo 650/i });

    await user.type(screen.getByLabelText(/Filter by drawer/i), "A3");

    await waitFor(() => {
      const call = get.mock.calls.at(-1);
      expect((call?.[1] as any)?.params?.drawer).toBe("A3");
    });
  });

  it("does not send a drawer filter when the box is empty", async () => {
    stub([MAPPED]);
    renderList();
    await screen.findByRole("button", { name: /Drawer for Dolo 650/i });

    // An empty filter must list everything, not everything mapped to "".
    const call = get.mock.calls.at(-1);
    expect((call?.[1] as any)?.params).not.toHaveProperty("drawer");
  });
});
