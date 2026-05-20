"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface CartItem {
  medicineId: string;
  batchId: string;
  name: string;
  sku: string;
  batchNo: string;
  unitPrice: number;
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
  addItem: (item: Omit<CartItem, "lineTotal">) => void;
  updateQty: (medicineId: string, batchId: string, qty: number) => void;
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
  const gross = i.unitPrice * i.quantity;
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
        const existing = get().items.find((i) => i.batchId === item.batchId);
        if (existing) {
          set((s) => ({ items: s.items.map((i) => i.batchId === item.batchId ? { ...i, quantity: i.quantity + item.quantity, lineTotal: calcLine({ ...i, quantity: i.quantity + item.quantity }) } : i) }));
        } else {
          set((s) => ({ items: [...s.items, { ...item, lineTotal: calcLine(item) }] }));
        }
      },
      updateQty: (medicineId, batchId, qty) => {
        if (qty <= 0) { get().removeItem(medicineId, batchId); return; }
        set((s) => ({ items: s.items.map((i) => i.batchId === batchId ? { ...i, quantity: qty, lineTotal: calcLine({ ...i, quantity: qty }) } : i) }));
      },
      removeItem: (_, batchId) => set((s) => ({ items: s.items.filter((i) => i.batchId !== batchId) })),
      setPatient: (id) => set({ patientId: id }),
      setBranchId: (id) => set({ branchId: id }),
      setPrescriptionId: (id) => set({ prescriptionId: id }),
      setLoyaltyPointsToRedeem: (points) => set({ loyaltyPointsToRedeem: points }),
      clear: () => set({ items: [], patientId: null, prescriptionId: null, loyaltyPointsToRedeem: 0 }),
      totals: () => {
        const items = get().items;
        const subtotal = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
        const discount = items.reduce((s, i) => s + (i.unitPrice * i.quantity * i.discountPct) / 100, 0);
        const taxable = subtotal - discount;
        const tax = items.reduce((s, i) => s + ((i.unitPrice * i.quantity - (i.unitPrice * i.quantity * i.discountPct) / 100) * i.taxPct) / 100, 0);
        return { subtotal, tax, discount, total: taxable + tax };
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
