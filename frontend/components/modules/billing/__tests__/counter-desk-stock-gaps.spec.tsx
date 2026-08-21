import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * The counter desk is where staff find out the shelf is empty, or that a
 * medicine was never in the catalogue at all. Both fixes are offered on this
 * screen, so what is checked here is that the search results carry them:
 *
 *  - an out-of-stock row cannot be sold, but can be restocked on the spot,
 *    and the restock modal opens straight into the receive-batch form for
 *    that exact medicine;
 *  - a search that matches no medicine offers to register one, with the
 *    typed name already filled in;
 *  - neither appears for a user without the inventory / catalogue grant.
 */

const get = vi.fn();
const post = vi.fn();

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
  },
  queryKeys: {
    medicines: { all: () => ["medicines"], list: () => ["medicines", "list"] },
    invoices: { all: () => ["invoices"] },
  },
}));

vi.mock("@/hooks/use-branch", () => ({
  useActiveBranchId: () => ({ branchId: "branch-1" }),
}));

// The 300ms debounce would otherwise have to be waited out in every test.
vi.mock("@/hooks/use-debounce", () => ({
  useDebounce: (v: unknown) => v,
}));

vi.mock("@/lib/navigation-context", () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
}));

vi.mock("@/queries/clinic.queries", () => ({
  useCreateClinicToken: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

let granted: string[] = [];
vi.mock("@/hooks/use-permissions", () => ({
  usePermissions: () => ({
    can: (p: string) => granted.includes(p),
    role: "admin",
  }),
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock("@/stores/auth.store", () => ({
  useAuthStore: (selector?: any) => {
    const state = { user: { id: "mgr-1", role: "admin" } };
    return selector ? selector(state) : state;
  },
}));

// Heavy children the counter desk composes — stubbed so this spec is about the
// search results only. The two under test report the props they were handed.
vi.mock("@/components/modules/billing/counter-desk-modals", () => ({
  CounterDeskModals: () => null,
  DeskModalView: {},
}));
vi.mock("@/components/modules/billing/doctor-medicines-panel", () => ({
  DoctorMedicinesPanel: () => null,
}));
vi.mock("@/components/modules/billing/doctors-overview", () => ({
  DoctorsOverview: () => null,
}));
vi.mock("@/components/modules/billing/otc-counter-sale", () => ({
  OtcCounterSale: () => null,
}));
vi.mock("@/components/modules/billing/invoice-detail-modal", () => ({
  InvoiceDetailModal: () => null,
}));
vi.mock("@/components/modules/patients/quick-patient-form", () => ({
  QuickPatientForm: () => null,
}));

vi.mock("@/components/modules/inventory/medicine-stock-modal", () => ({
  MedicineStockModal: ({ open, medicineId, medicineName, autoOpenAddStock }: any) =>
    open ? (
      <div
        data-testid="stock-modal"
        data-medicine-id={medicineId}
        data-auto-open={String(!!autoOpenAddStock)}
      >
        restocking {medicineName}
      </div>
    ) : null,
}));

vi.mock("@/components/modules/inventory/medicine-form", () => ({
  MedicineForm: ({ initial }: any) => (
    <div
      data-testid="medicine-form"
      data-name={initial?.name}
      data-requires-rx={String(!!initial?.requiresPrescription)}
    />
  ),
}));

import { PatientFirstBilling } from "../patient-first-billing";
import { useCartStore } from "@/stores/cart.store";

const OUT_OF_STOCK = {
  id: "med-1",
  name: "Paracetamol 500mg",
  sku: "MED-001",
  scheduleClass: null,
  totalStock: 0,
  stripSize: 1,
  unit: "strip",
};

const IN_STOCK = {
  id: "med-2",
  name: "Aceclo Plus 100 mg/325 mg Tablet",
  sku: "MED03991",
  scheduleClass: "H",
  totalStock: 266,
  stripSize: 1,
  unit: "strip",
};

/** Routes every counter-desk query; only the two search calls carry data. */
function stubApi({ medicines = [] as any[], patients = [] as any[] } = {}) {
  get.mockImplementation((url: string) => {
    if (url === "/inventory/medicines") return Promise.resolve({ data: medicines });
    if (url === "/patients") return Promise.resolve({ data: patients });
    if (url === "/billing/reports/end-of-day") return Promise.resolve({ data: { totalSales: 0 } });
    return Promise.resolve({ data: [] });
  });
}

function renderDesk() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PatientFirstBilling />
    </QueryClientProvider>,
  );
}

async function search(text: string) {
  const box = screen.getByPlaceholderText(/search/i);
  await userEvent.type(box, text);
}

describe("counter desk — closing stock gaps from the search results", () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    window.localStorage.clear();
    useCartStore.getState().clear();
    granted = ["billing.create", "inventory.adjust", "inventory.write", "products.write"];
  });

  it("cannot sell an out-of-stock medicine, but offers to restock it", async () => {
    stubApi({ medicines: [OUT_OF_STOCK, IN_STOCK] });
    renderDesk();
    await search("parace");

    await waitFor(() => expect(screen.getByText("Paracetamol 500mg")).toBeInTheDocument());

    // Two rows, two OTC buttons — the out-of-stock one is the disabled one.
    const otcButtons = screen.getAllByRole("button", { name: /OTC sale/i });
    expect(otcButtons).toHaveLength(2);
    expect(otcButtons[0]).toBeDisabled();
    expect(otcButtons[1]).toBeEnabled();

    // The empty row is the one that spells out the fix in words; the stocked
    // row carries only the quiet icon, whose title names it differently.
    expect(screen.getByRole("button", { name: "Add stock" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Add stock — receive another batch/i }),
    ).toBeInTheDocument();
  });

  it("opens the restock form for the medicine whose row was clicked", async () => {
    stubApi({ medicines: [OUT_OF_STOCK, IN_STOCK] });
    renderDesk();
    await search("parace");

    await waitFor(() => expect(screen.getByText("Paracetamol 500mg")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Add stock" }));

    const modal = await screen.findByTestId("stock-modal");
    expect(modal).toHaveAttribute("data-medicine-id", "med-1");
    // Opening from the counter means "fix this now" — land in the form.
    expect(modal).toHaveAttribute("data-auto-open", "true");
  });

  it("offers a quiet top-up on a row that still has stock", async () => {
    stubApi({ medicines: [IN_STOCK] });
    renderDesk();
    await search("aceclo");

    await waitFor(() => expect(screen.getByText(IN_STOCK.name)).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /Add stock — receive another batch/i }));

    expect(await screen.findByTestId("stock-modal")).toHaveAttribute("data-medicine-id", "med-2");
  });

  it("registers a medicine the catalogue has never seen, name prefilled", async () => {
    stubApi({ medicines: [], patients: [] });
    renderDesk();
    await search("zocaline");

    const add = await screen.findByRole("button", { name: /Add .*zocaline.* to catalogue/i });
    await userEvent.click(add);

    const form = await screen.findByTestId("medicine-form");
    expect(form).toHaveAttribute("data-name", "zocaline");
    // Fail-safe: a rushed counter entry must not register a Schedule H drug as
    // OTC and slip past the Rx gate.
    expect(form).toHaveAttribute("data-requires-rx", "true");
  });

  it("still offers to add the medicine when only a patient matched", async () => {
    stubApi({
      medicines: [],
      patients: [{ id: "pat-1", name: "Zocaline Roy", phone: "9800000000" }],
    });
    renderDesk();
    await search("zocaline");

    await waitFor(() => expect(screen.getByText("Zocaline Roy")).toBeInTheDocument());
    const add = await screen.findByRole("button", { name: /^Add medicine$/i });
    await userEvent.click(add);

    expect(await screen.findByTestId("medicine-form")).toHaveAttribute("data-name", "zocaline");
  });

  it("hides both fixes from a user without the inventory and catalogue grants", async () => {
    granted = ["billing.create"];
    stubApi({ medicines: [OUT_OF_STOCK] });
    renderDesk();
    await search("parace");

    await waitFor(() => expect(screen.getByText("Paracetamol 500mg")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Add stock/i })).not.toBeInTheDocument();

    // And nothing to register either, once the catalogue grant is gone.
    get.mockClear();
    expect(screen.queryByRole("button", { name: /to catalogue/i })).not.toBeInTheDocument();
  });
});
