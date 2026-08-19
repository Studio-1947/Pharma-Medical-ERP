import { describe, it, expect, beforeEach } from "vitest";
import { useCartStore } from "../cart.store";

/**
 * The cart is persisted to localStorage, so anything it holds outlives the
 * sale unless something clears it. Everything below is about one customer's
 * details not leaking into the next customer's bill.
 */

const ITEM = {
  medicineId: "med-1",
  batchId: "batch-1",
  name: "Paracetamol",
  sku: "PARA",
  batchNo: "B1",
  expiry: "2027-01-01",
  unitPrice: 100,
  taxPct: 12,
  discountPct: 0,
  quantity: 1,
};

beforeEach(() => {
  useCartStore.getState().clear();
  useCartStore.setState({ branchId: "branch-1" });
});

describe("cart patient switching", () => {
  it("drops the previous patient's prescription, fee and loyalty redemption", () => {
    const s = useCartStore.getState();
    s.setPatient("patient-a");
    s.setPrescriptionId("rx-from-clinic-visit");
    s.setConsultationFee({ doctorName: "Dr Rao", amount: 400 } as any);
    s.setLoyaltyPointsToRedeem(200);

    useCartStore.getState().setPatient("patient-b");

    const after = useCartStore.getState();
    expect(after.patientId).toBe("patient-b");
    // The clinic token prints from the invoice's prescription, so carrying
    // this over stamped the next bill with someone else's queue token.
    expect(after.prescriptionId).toBeNull();
    expect(after.consultationFee).toBeNull();
    expect(after.loyaltyPointsToRedeem).toBe(0);
  });

  it("keeps the prescription when the same patient is re-selected", () => {
    const s = useCartStore.getState();
    s.setPatient("patient-a");
    s.setPrescriptionId("rx-1");

    useCartStore.getState().setPatient("patient-a");

    expect(useCartStore.getState().prescriptionId).toBe("rx-1");
  });

  it("drops the prescription when the cart falls back to a walk-in", () => {
    const s = useCartStore.getState();
    s.setPatient("patient-a");
    s.setPrescriptionId("rx-1");

    useCartStore.getState().setPatient(null);

    expect(useCartStore.getState().patientId).toBeNull();
    expect(useCartStore.getState().prescriptionId).toBeNull();
  });

  it("clear() empties every patient-scoped field", () => {
    const s = useCartStore.getState();
    s.addItem(ITEM as any);
    s.setPatient("patient-a");
    s.setPrescriptionId("rx-1");
    s.setConsultationFee({ doctorName: "Dr Rao", amount: 400 } as any);
    s.setLoyaltyPointsToRedeem(100);

    useCartStore.getState().clear();

    const after = useCartStore.getState();
    expect(after.items).toHaveLength(0);
    expect(after.patientId).toBeNull();
    expect(after.prescriptionId).toBeNull();
    expect(after.consultationFee).toBeNull();
    expect(after.loyaltyPointsToRedeem).toBe(0);
  });
});
