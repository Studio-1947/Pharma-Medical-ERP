import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  patch: vi.fn().mockResolvedValue({}),
  add: vi.fn().mockResolvedValue({}),
  invalidate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/api-client", () => ({ apiClient: { patch: mocks.patch } }));
vi.mock("@/lib/query-invalidation", () => ({
  invalidateMedicineViews: mocks.invalidate,
}));
vi.mock("@/queries/clinic.queries", () => ({
  useDoctorMedicines: () => ({ data: { data: [] }, isLoading: false }),
  useAddDoctorMedicine: () => ({ mutateAsync: mocks.add, isPending: false }),
  useUpdateDoctorMedicine: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveDoctorMedicine: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useImportDoctorMedicines: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/components/modules/prescriptions/medicine-autocomplete", () => ({
  MedicineAutocomplete: ({ onSelect }: any) => (
    <button
      type="button"
      onClick={() => onSelect({ id: "med-inactive", name: "Amaze-Q10", isActive: false, priceMrp: "0" })}
    >
      Pick inactive medicine
    </button>
  ),
}));
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/components/modules/billing/doctor-medicines-panel", () => ({
  isControlledRow: () => false,
  normalizeSchedule: () => null,
}));

import { DoctorMedicineManager } from "../doctor-medicine-manager";

describe("DoctorMedicineManager inactive medicine activation", () => {
  it("sets MRP, activates, and adds the medicine to the doctor's list", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DoctorMedicineManager
          open
          onClose={vi.fn()}
          doctorId="doctor-1"
          doctorName="Dr Richard"
          branchId="branch-1"
        />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Pick inactive medicine" }));
    const mrp = await screen.findByLabelText(/MRP/i);
    fireEvent.change(mrp, { target: { value: "125.50" } });
    fireEvent.click(screen.getByRole("button", { name: /Activate & Add to List/i }));

    await waitFor(() => {
      expect(mocks.patch).toHaveBeenCalledWith("/inventory/medicines/med-inactive", {
        priceMrp: "125.50",
        isActive: true,
      });
      expect(mocks.add).toHaveBeenCalledWith(expect.objectContaining({ medicineId: "med-inactive" }));
    });
  });
});
