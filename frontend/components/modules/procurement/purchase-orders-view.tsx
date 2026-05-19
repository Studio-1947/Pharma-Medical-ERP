"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Plus, Search, FileText, CheckCircle, XCircle, Send, PlusCircle } from "lucide-react";
import { Modal } from "@/components/ui/modal";

interface POItem {
  id: string;
  medicineId: string;
  orderedQty: number;
  unitCost: string;
  taxPct: string;
}

interface PO {
  id: string;
  poNumber: string;
  supplierId: string;
  warehouseId: string;
  status: string;
  expectedDelivery?: string;
  totalAmount: string;
  notes?: string;
  items: POItem[];
  supplier?: { name: string };
  warehouse?: { name: string };
}

export function PurchaseOrdersView() {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedPO, setSelectedPO] = useState<PO | null>(null);

  // For Create PO Modal
  const [form, setForm] = useState({
    supplierId: "",
    warehouseId: "",
    expectedDelivery: "",
    notes: "",
    items: [{ medicineId: "", orderedQty: 1, unitCost: "0", taxPct: "0" }],
  });

  const { data: rawPOs, isLoading } = useQuery({
    queryKey: ["purchase-orders"],
    queryFn: () => apiClient.get("/procurement/purchase-orders"),
  });

  const { data: rawSuppliers } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => apiClient.get("/procurement/suppliers"),
  });

  const { data: rawMedicines } = useQuery({
    queryKey: ["medicines"],
    queryFn: () => apiClient.get("/inventory/medicines"),
  });

  const { data: rawWarehouses } = useQuery({
    queryKey: ["warehouses"],
    queryFn: () => apiClient.get("/inventory/warehouses"),
  });

  const pos: PO[] = (() => {
    const d = rawPOs as any;
    if (Array.isArray(d)) return d;
    if (Array.isArray(d?.data)) return d.data;
    if (Array.isArray(d?.data?.data)) return d.data.data;
    if (Array.isArray(d?.rows)) return d.rows;
    return [];
  })();

  const suppliers = (() => {
    const d = rawSuppliers as any;
    if (Array.isArray(d)) return d;
    if (Array.isArray(d?.data)) return d.data;
    if (Array.isArray(d?.data?.data)) return d.data.data;
    if (Array.isArray(d?.rows)) return d.rows;
    return [];
  })();

  const medicines = (() => {
    const d = rawMedicines as any;
    if (Array.isArray(d)) return d;
    if (Array.isArray(d?.data)) return d.data;
    if (Array.isArray(d?.data?.data)) return d.data.data;
    if (Array.isArray(d?.rows)) return d.rows;
    return [];
  })();

  const warehouses = (() => {
    const d = rawWarehouses as any;
    if (Array.isArray(d)) return d;
    if (Array.isArray(d?.data)) return d.data;
    if (Array.isArray(d?.data?.data)) return d.data.data;
    if (Array.isArray(d?.rows)) return d.rows;
    return [];
  })();

  const createPOMutation = useMutation({
    mutationFn: (data: any) => apiClient.post("/procurement/purchase-orders", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      handleClose();
    },
    onError: (err: any) => {
      alert(err?.response?.data?.message ?? "Error creating purchase order.");
    },
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, approved }: { id: string; approved: boolean }) =>
      apiClient.post(`/procurement/purchase-orders/${id}/approve`, { approved }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
  });

  const sendMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/procurement/purchase-orders/${id}/send`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/procurement/purchase-orders/${id}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
  });

  function openCreate() {
    setForm({
      supplierId: suppliers[0]?.id || "",
      warehouseId: warehouses[0]?.id || "",
      expectedDelivery: "",
      notes: "",
      items: [{ medicineId: medicines[0]?.id || "", orderedQty: 1, unitCost: "0", taxPct: "0" }],
    });
    setIsOpen(true);
  }

  function handleClose() {
    setIsOpen(false);
  }

  function handleAddItem() {
    setForm({
      ...form,
      items: [...form.items, { medicineId: medicines[0]?.id || "", orderedQty: 1, unitCost: "0", taxPct: "0" }],
    });
  }

  function handleRemoveItem(idx: number) {
    if (form.items.length <= 1) return;
    setForm({
      ...form,
      items: form.items.filter((_, i) => i !== idx),
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.supplierId || !form.warehouseId || form.items.some((i) => !i.medicineId || i.orderedQty <= 0)) {
      alert("All fields are required and quantity must be greater than 0");
      return;
    }

    const payload = {
      supplierId: form.supplierId,
      warehouseId: form.warehouseId,
      expectedDelivery: form.expectedDelivery || undefined,
      notes: form.notes || undefined,
      items: form.items.map((i) => ({
        ...i,
        orderedQty: Number(i.orderedQty),
        unitCost: String(i.unitCost),
      })),
    };

    createPOMutation.mutate(payload);
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-base font-semibold">Track & Create Purchase Orders</h3>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:opacity-90 shadow-sm transition-all"
        >
          <PlusCircle className="w-4 h-4" /> Create Draft PO
        </button>
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-muted rounded-xl" />
          ))}
        </div>
      ) : pos.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border rounded-xl bg-white backdrop-blur-md bg-opacity-60">
          No purchase orders found. Click "Create Draft PO" to get started.
        </div>
      ) : (
        <div className="bg-card rounded-xl border shadow-sm overflow-hidden bg-white backdrop-blur-md bg-opacity-70">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 text-muted-foreground font-medium border-b">
                <tr>
                  <th className="px-6 py-4">PO Number</th>
                  <th className="px-6 py-4">Supplier</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Expected Delivery</th>
                  <th className="px-6 py-4">Total Amount</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {pos.map((po: any) => (
                  <tr key={po.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-4 font-mono text-xs">{po.poNumber}</td>
                    <td className="px-6 py-4 font-medium text-slate-800">
                      {po.supplier?.name || "Supplier"}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          po.status === "draft"
                            ? "bg-amber-100 text-amber-700"
                            : po.status === "approved"
                            ? "bg-emerald-100 text-emerald-700"
                            : po.status === "sent"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {po.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">
                      {po.expectedDelivery || "--"}
                    </td>
                    <td className="px-6 py-4 font-bold text-slate-800">
                      ₹{po.totalAmount}
                    </td>
                    <td className="px-6 py-4 text-right flex gap-2 justify-end">
                      {po.status === "draft" && (
                        <>
                          <button
                            onClick={() => approveMutation.mutate({ id: po.id, approved: true })}
                            className="p-2 hover:bg-emerald-50 rounded-lg text-emerald-600 transition-colors font-medium text-xs"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => cancelMutation.mutate(po.id)}
                            className="p-2 hover:bg-red-50 rounded-lg text-red-600 transition-colors font-medium text-xs"
                          >
                            Cancel
                          </button>
                        </>
                      )}
                      {po.status === "approved" && (
                        <button
                          onClick={() => sendMutation.mutate(po.id)}
                          className="p-2 hover:bg-blue-50 rounded-lg text-blue-600 transition-colors font-medium text-xs flex items-center gap-1"
                        >
                          <Send className="w-3.5 h-3.5" /> Send
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Draft PO Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-xl w-full border max-h-[90vh] overflow-y-auto p-6">
            <h3 className="text-lg font-bold mb-4">Create Draft Purchase Order</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold">Supplier *</label>
                  <select
                    required
                    value={form.supplierId}
                    onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  >
                    {suppliers.map((s: any) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold">Warehouse *</label>
                  <select
                    required
                    value={form.warehouseId}
                    onChange={(e) => setForm({ ...form, warehouseId: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  >
                    {warehouses.map((w: any) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold">Expected Delivery Date</label>
                  <input
                    type="date"
                    value={form.expectedDelivery}
                    onChange={(e) => setForm({ ...form, expectedDelivery: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold">Notes</label>
                  <input
                    type="text"
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  />
                </div>
              </div>

              <div className="border-t pt-4">
                <div className="flex justify-between items-center mb-2">
                  <label className="text-xs font-semibold text-slate-700">Order Items *</label>
                  <button
                    type="button"
                    onClick={handleAddItem}
                    className="text-xs font-bold text-blue-600 hover:underline"
                  >
                    + Add Item
                  </button>
                </div>

                <div className="space-y-3 max-h-48 overflow-y-auto pr-1">
                  {form.items.map((item: any, idx: number) => (
                    <div key={idx} className="flex gap-3 items-end">
                      <div className="flex-1">
                        <label className="text-[10px] text-muted-foreground uppercase">Medicine</label>
                        <select
                          required
                          value={item.medicineId}
                          onChange={(e) => {
                            const n = [...form.items];
                            if (n[idx]) n[idx].medicineId = e.target.value;
                            setForm({ ...form, items: n });
                          }}
                          className="w-full border rounded-lg px-2 py-1.5 text-xs bg-background"
                        >
                          {medicines.map((m: any) => (
                            <option key={m.id} value={m.id}>
                              {m.name} ({m.sku})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="w-20">
                        <label className="text-[10px] text-muted-foreground uppercase">Qty</label>
                        <input
                          type="number"
                          required
                          min={1}
                          value={item.orderedQty}
                          onChange={(e) => {
                            const n = [...form.items];
                            if (n[idx]) n[idx].orderedQty = Number(e.target.value);
                            setForm({ ...form, items: n });
                          }}
                          className="w-full border rounded-lg px-2 py-1.5 text-xs font-mono"
                        />
                      </div>
                      <div className="w-24">
                        <label className="text-[10px] text-muted-foreground uppercase">Cost (₹)</label>
                        <input
                          type="text"
                          required
                          value={item.unitCost}
                          onChange={(e) => {
                            const n = [...form.items];
                            if (n[idx]) n[idx].unitCost = e.target.value;
                            setForm({ ...form, items: n });
                          }}
                          className="w-full border rounded-lg px-2 py-1.5 text-xs font-mono"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(idx)}
                        disabled={form.items.length === 1}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors font-bold disabled:opacity-30"
                      >
                        🗑️
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t mt-4">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-4 py-2 border rounded-lg text-sm font-semibold hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors shadow-sm"
                >
                  {createPOMutation.isPending ? "Creating..." : "Save Draft"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
