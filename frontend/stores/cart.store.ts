"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";

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
  loyaltyPointsToRedeem: number;
  addItem: (item: Omit<CartItem, "lineTotal" | "saleUnit" | "stripSize"> & { stripSize?: number; saleUnit?: "pack" | "loose" }) => void;
  updateQty: (medicineId: string, batchId: string, qty: number) => void;
  toggleUnit: (medicineId: string, batchId: string) => void;
  removeItem: (medicineId: string, batchId: string) => void;
  setPatient: (id: string | null) => void;
  setBranchId: (id: string) => void;
  setPrescriptionId: (id: string | null) => void;
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
      setPatient: (id) => set({ patientId: id }),
      setBranchId: (id) => set({ branchId: id }),
      setPrescriptionId: (id) => set({ prescriptionId: id }),
      setLoyaltyPointsToRedeem: (points) => set({ loyaltyPointsToRedeem: points }),
      clear: () => set({ items: [], patientId: null, prescriptionId: null, loyaltyPointsToRedeem: 0 }),
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
        return { subtotal, tax, discount, total: subtotal - discount + tax };
      },
      hasControlledItems: () => {
        const controlled = ["SCHEDULE_H", "SCHEDULE_H1", "SCHEDULE_X"];
        return get().items.some(
          (i) => (i.scheduleClass && controlled.includes(i.scheduleClass)) || i.requiresPrescription
        );
      },
    }),
    {
      name: "pharmerp-cart",
      skipHydration: true,
      partialize: (s) => ({ items: s.items, patientId: s.patientId, prescriptionId: s.prescriptionId, branchId: s.branchId }),
    },
  ),
);
