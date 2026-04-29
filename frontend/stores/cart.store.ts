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
}

interface CartState {
  items: CartItem[];
  patientId: string | null;
  branchId: string;
  addItem: (item: Omit<CartItem, "lineTotal">) => void;
  updateQty: (medicineId: string, batchId: string, qty: number) => void;
  removeItem: (medicineId: string, batchId: string) => void;
  setPatient: (id: string | null) => void;
  clear: () => void;
  totals: () => { subtotal: number; tax: number; discount: number; total: number };
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
      clear: () => set({ items: [], patientId: null }),
      totals: () => {
        const items = get().items;
        const subtotal = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
        const discount = items.reduce((s, i) => s + (i.unitPrice * i.quantity * i.discountPct) / 100, 0);
        const taxable = subtotal - discount;
        const tax = items.reduce((s, i) => s + ((i.unitPrice * i.quantity - (i.unitPrice * i.quantity * i.discountPct) / 100) * i.taxPct) / 100, 0);
        return { subtotal, tax, discount, total: taxable + tax };
      },
    }),
    { name: "pharmerp-cart", partialize: (s) => ({ items: s.items, patientId: s.patientId }) },
  ),
);
