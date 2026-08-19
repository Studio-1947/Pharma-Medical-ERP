"use client";
import { create } from "zustand";
import { isControlledRow } from "@/lib/schedule-class";
import { persist } from "zustand/middleware";

// Doctor consultation fee attached to a prescription dispense. Billed as a
// GST-exempt service line — no stock, no batch, shown as its own cart row.
export interface ConsultationFee {
  doctorName: string;
  amount: number;
}

export interface CartItem {
  medicineId: string;
  batchId: string;
  name: string;
  sku: string;
  batchNo: string;
  unitPrice: number; // The MRP of the pack/strip
  stripSize: number; // Number of loose pills per pack/strip
  saleUnit: "pack" | "loose";
  unit?: string | null;
  batchStock?: number;
  totalStock?: number;
  taxPct: number;
  discountPct: number;
  quantity: number;
  lineTotal: number;
  scheduleClass?: string | null;
  requiresPrescription?: boolean;
}

interface CartState {
  items: CartItem[];
  patientId: string | null;
  branchId: string;
  prescriptionId: string | null;
  consultationFee: ConsultationFee | null;
  loyaltyPointsToRedeem: number;
  addItem: (item: Omit<CartItem, "lineTotal" | "saleUnit" | "stripSize"> & { stripSize?: number; saleUnit?: "pack" | "loose" }) => void;
  updateQty: (medicineId: string, batchId: string, qty: number) => void;
  updateDiscountPct: (medicineId: string, batchId: string, discPct: number) => void;
  toggleUnit: (medicineId: string, batchId: string) => void;
  removeItem: (medicineId: string, batchId: string) => void;
  setPatient: (id: string | null) => void;
  setBranchId: (id: string) => void;
  setPrescriptionId: (id: string | null) => void;
  setConsultationFee: (fee: ConsultationFee | null) => void;
  setLoyaltyPointsToRedeem: (points: number) => void;
  clear: () => void;
  totals: () => { subtotal: number; tax: number; discount: number; total: number };
  hasControlledItems: () => boolean;
}

function calcLine(i: Omit<CartItem, "lineTotal">) {
  const price = i.saleUnit === "loose" ? i.unitPrice / (i.stripSize || 1) : i.unitPrice;
  const gross = price * i.quantity;
  const disc = (gross * i.discountPct) / 100;
  const taxable = gross - disc;
  return taxable + (taxable * i.taxPct) / 100;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      patientId: null,
      branchId: "",
      prescriptionId: null,
      consultationFee: null,
      loyaltyPointsToRedeem: 0,
      addItem: (item) => {
        const stripSize = item.stripSize ?? 1;
        const saleUnit = item.saleUnit ?? "pack";
        const newItem: CartItem = {
          ...item,
          stripSize,
          saleUnit,
          lineTotal: 0,
        };
        newItem.lineTotal = calcLine(newItem);

        const existing = get().items.find((i) => i.batchId === item.batchId);
        if (existing) {
          set((s) => ({
            items: s.items.map((i) =>
              i.batchId === item.batchId
                ? {
                    ...i,
                    quantity: i.quantity + item.quantity,
                    lineTotal: calcLine({ ...i, quantity: i.quantity + item.quantity }),
                  }
                : i
            ),
          }));
        } else {
          set((s) => ({ items: [...s.items, newItem] }));
        }
      },
      updateQty: (medicineId, batchId, qty) => {
        if (qty <= 0) { get().removeItem(medicineId, batchId); return; }
        set((s) => ({
          items: s.items.map((i) =>
            i.batchId === batchId
              ? { ...i, quantity: qty, lineTotal: calcLine({ ...i, quantity: qty }) }
              : i
          ),
        }));
      },
      updateDiscountPct: (medicineId, batchId, discPct) => {
        const validPct = Math.max(0, Math.min(100, discPct));
        set((s) => ({
          items: s.items.map((i) =>
            i.batchId === batchId
              ? { ...i, discountPct: validPct, lineTotal: calcLine({ ...i, discountPct: validPct }) }
              : i
          ),
        }));
      },
      toggleUnit: (medicineId, batchId) => {
        set((s) => ({
          items: s.items.map((i) => {
            if (i.batchId !== batchId) return i;
            const nextUnit = i.saleUnit === "pack" ? "loose" : "pack";
            const nextQty =
              nextUnit === "loose"
                ? i.quantity * i.stripSize
                : Math.max(1, Math.floor(i.quantity / i.stripSize));
            return {
              ...i,
              saleUnit: nextUnit,
              quantity: nextQty,
              lineTotal: calcLine({ ...i, saleUnit: nextUnit, quantity: nextQty }),
            };
          }),
        }));
      },
      removeItem: (_, batchId) => set((s) => ({ items: s.items.filter((i) => i.batchId !== batchId) })),
      /**
       * Switching patient drops everything that belonged to the last one.
       *
       * A prescription, a consultation fee and a loyalty redemption all belong
       * to one person, but the cart is persisted to localStorage, so they used
       * to survive into the next customer's bill. The prescription was the
       * dangerous one: the Rx banner only renders when the cart holds a
       * controlled item, so on an ordinary sale a stale link was invisible —
       * and it stamped the printed receipt with the previous patient's clinic
       * queue token, because the token is looked up through the invoice's
       * prescription.
       */
      setPatient: (id) =>
        set((s) =>
          s.patientId === id
            ? { patientId: id }
            : {
                patientId: id,
                prescriptionId: null,
                consultationFee: null,
                loyaltyPointsToRedeem: 0,
              },
        ),
      setBranchId: (id) => set({ branchId: id }),
      setPrescriptionId: (id) => set({ prescriptionId: id }),
      setConsultationFee: (fee) => set({ consultationFee: fee }),
      setLoyaltyPointsToRedeem: (points) => set({ loyaltyPointsToRedeem: points }),
      clear: () => set({ items: [], patientId: null, prescriptionId: null, consultationFee: null, loyaltyPointsToRedeem: 0 }),
      totals: () => {
        const items = get().items;
        let subtotal = 0;
        let discount = 0;
        let tax = 0;
        items.forEach((i) => {
          const price = i.saleUnit === "loose" ? i.unitPrice / (i.stripSize || 1) : i.unitPrice;
          const gross = price * i.quantity;
          const disc = (gross * i.discountPct) / 100;
          const taxable = gross - disc;
          subtotal += gross;
          discount += disc;
          tax += (taxable * i.taxPct) / 100;
        });
        // Consultation fee is a GST-exempt service line — no tax, not discounted.
        const fee = get().consultationFee?.amount ?? 0;
        return { subtotal: subtotal + fee, tax, discount, total: subtotal - discount + tax + fee };
      },
      hasControlledItems: () =>
        // Both spellings — the catalogue writes "H1", the seed "SCHEDULE_H1".
        // Matching only the long form left this blocker resting on
        // requiresPrescription alone.
        get().items.some((i) => isControlledRow(i)),
    }),
    {
      name: "pharmerp-cart",
      skipHydration: true,
      partialize: (s) => ({ items: s.items, patientId: s.patientId, prescriptionId: s.prescriptionId, consultationFee: s.consultationFee, branchId: s.branchId }),
    },
  ),
);
