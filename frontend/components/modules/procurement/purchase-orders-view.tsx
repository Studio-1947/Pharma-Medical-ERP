"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth.store";
import { useToast } from "@/components/ui/toast";
import { Plus, Search, FileText, CheckCircle, XCircle, Send, PlusCircle, PackageCheck, Trash2, Loader2, Edit2 } from "lucide-react";
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
  totalValue: string;
  subtotal: string;
  taxAmount: string;
  notes?: string;
  items: POItem[];
  supplier?: { id: string; name: string; code: string };
  warehouse?: { name: string };
}

interface GrnLineItem {
  poItemId: string;
  batchNo: string;
  expiryDate: string;
  receivedQty: number;
  unitCost: string;
}

function GrnModal({
  poId,
  poNumber,
  open,
  onClose,
}: {
  poId: string;
  poNumber: string;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [lines, setLines] = useState<GrnLineItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const linesInitialisedRef = useRef(false);

  const { data: poDetailRaw, isLoading: loadingDetail } = useQuery({
    queryKey: ["po-detail", poId],
    queryFn: () => apiClient.get(`/procurement/purchase-orders/${poId}`),
    enabled: open && !!poId,
  });

  const poDetail: PO | null = (() => {
    const d = poDetailRaw as any;
    return d?.data ?? d ?? null;
  })();

  useEffect(() => {
    if (poDetail?.items && poDetail.items.length > 0 && !linesInitialisedRef.current) {
      linesInitialisedRef.current = true;
      setLines(
        poDetail.items.map((item) => ({
          poItemId: item.id,
          batchNo: "",
          expiryDate: "",
          receivedQty: item.orderedQty,
          unitCost: item.unitCost,
        }))
      );
    }
  }, [poDetail]);

  const mutation = useMutation({
    mutationFn: (items: GrnLineItem[]) =>
      apiClient.post(`/procurement/purchase-orders/${poId}/grn`, { items }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      onClose();
    },
    onError: (err: any) =>
      setError(err?.response?.data?.message ?? "GRN failed. Please try again."),
  });

  const updateLine = (idx: number, key: keyof GrnLineItem, value: string | number) => {
    setLines((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [key]: value } as GrnLineItem;
      return next;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    for (const l of lines) {
      if (!l.batchNo.trim()) { setError("Batch number is required for all items."); return; }
      if (!l.expiryDate) { setError("Expiry date is required for all items."); return; }
      if (l.receivedQty <= 0) { setError("Received quantity must be greater than 0."); return; }
    }
    mutation.mutate(lines);
  };

  return (
    <Modal
      title="Goods Received Note (GRN)"
      subtitle={`Receiving stock for PO: ${poNumber}`}
      icon={<PackageCheck size={16} />}
      open={open}
      onClose={onClose}
      size="2xl"
    >
      <form onSubmit={handleSubmit} className="px-6 py-5">
        {loadingDetail ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground gap-2 text-sm">
            <Loader2 size={16} className="animate-spin" /> Loading order details...
          </div>
        ) : lines.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">No line items found for this order.</div>
        ) : null}
        {!loadingDetail && lines.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <th className="text-left py-2 pr-3">Item / Medicine ID</th>
                <th className="text-left py-2 pr-3">Batch No <span className="text-red-500">*</span></th>
                <th className="text-left py-2 pr-3">Expiry Date <span className="text-red-500">*</span></th>
                <th className="text-right py-2 pr-3">Rcvd Qty <span className="text-red-500">*</span></th>
                <th className="text-right py-2">Unit Cost (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {lines.map((line, idx) => (
                <tr key={idx} className="py-1">
                  <td className="py-2 pr-3">
                    <span className="font-mono text-xs text-emerald-600">
                      {(poDetail?.items[idx] as any)?.medicine?.name ?? (poDetail?.items[idx] as any)?.medicineId ?? line.poItemId}
                    </span>
                    <div className="text-[10px] text-muted-foreground">
                      Ordered: {poDetail?.items[idx]?.orderedQty}
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      required
                      value={line.batchNo}
                      onChange={(e) => updateLine(idx, "batchNo", e.target.value)}
                      placeholder="e.g. BTC-2024-001"
                      className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-400"
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      required
                      type="date"
                      value={line.expiryDate}
                      onChange={(e) => updateLine(idx, "expiryDate", e.target.value)}
                      className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-400"
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      required
                      type="number"
                      min="1"
                      value={line.receivedQty}
                      onChange={(e) => updateLine(idx, "receivedQty", Number(e.target.value))}
                      className="w-20 border rounded px-2 py-1 text-xs text-right font-mono focus:outline-none focus:ring-1 focus:ring-emerald-400 ml-auto block"
                    />
                  </td>
                  <td className="py-2">
                    <input
                      type="text"
                      value={line.unitCost}
                      onChange={(e) => updateLine(idx, "unitCost", e.target.value)}
                      className="w-24 border rounded px-2 py-1 text-xs text-right font-mono focus:outline-none focus:ring-1 focus:ring-emerald-400 ml-auto block"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}

        {error && (
          <div className="mt-3 text-sm text-red-600 flex items-center gap-1.5">
            <XCircle size={14} />
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            {mutation.isPending ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Receiving...
              </>
            ) : (
              <>
                <PackageCheck size={14} />
                Confirm Receipt
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function PurchaseOrdersView() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const { error: toastError, warning: toastWarning, success: toastSuccess } = useToast();
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";

  const [isOpen, setIsOpen] = useState(false);
  const [editingPO, setEditingPO] = useState<PO | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [selectedPO, setSelectedPO] = useState<PO | null>(null);
  const [grnPO, setGrnPO] = useState<{ id: string; poNumber: string } | null>(null);

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
      toastError("Failed to create purchase order", err?.response?.data?.message ?? "An unexpected error occurred. Please try again.");
    },
  });

  const updatePOMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: object }) =>
      apiClient.patch(`/procurement/purchase-orders/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      toastSuccess("PO updated", "Purchase order has been updated.");
      setEditingPO(null);
      setIsOpen(false);
    },
    onError: (err: any) => {
      toastError("Update failed", err?.response?.data?.message ?? "Could not update purchase order.");
    },
  });

  const deletePOMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/procurement/purchase-orders/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      toastSuccess("PO deleted", "Draft purchase order has been removed.");
      setConfirmDeleteId(null);
    },
    onError: (err: any) => {
      toastError("Delete failed", err?.response?.data?.message ?? "Could not delete purchase order.");
      setConfirmDeleteId(null);
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
    setEditingPO(null);
    setForm({
      supplierId: suppliers[0]?.id || "",
      warehouseId: warehouses[0]?.id || "",
      expectedDelivery: "",
      notes: "",
      items: [{ medicineId: medicines[0]?.id || "", orderedQty: 1, unitCost: "0", taxPct: "0" }],
    });
    setIsOpen(true);
  }

  function openEdit(po: PO) {
    setEditingPO(po);
    setForm({
      supplierId: po.supplierId,
      warehouseId: po.warehouseId,
      expectedDelivery: po.expectedDelivery ?? "",
      notes: po.notes ?? "",
      items: po.items?.length
        ? po.items.map((i) => ({
            medicineId: i.medicineId,
            orderedQty: i.orderedQty,
            unitCost: i.unitCost,
            taxPct: i.taxPct,
          }))
        : [{ medicineId: medicines[0]?.id || "", orderedQty: 1, unitCost: "0", taxPct: "0" }],
    });
    setIsOpen(true);
  }

  function handleClose() {
    setIsOpen(false);
    setEditingPO(null);
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
      toastWarning("Incomplete order", "All fields are required and each item quantity must be greater than 0.");
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

    if (editingPO) {
      updatePOMutation.mutate({ id: editingPO.id, data: payload });
    } else {
      createPOMutation.mutate(payload);
    }
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
                            ? "bg-emerald-100 text-emerald-700"
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
                      ₹{parseFloat(po.totalValue ?? "0").toFixed(2)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {po.status === "draft" && (
                          <>
                            <button
                              onClick={() => openEdit(po as PO)}
                              className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground hover:text-primary transition-colors"
                              title="Edit draft PO"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => approveMutation.mutate({ id: po.id, approved: true })}
                              className="px-2 py-1 hover:bg-emerald-50 rounded-lg text-emerald-600 transition-colors font-medium text-xs"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => cancelMutation.mutate(po.id)}
                              className="px-2 py-1 hover:bg-red-50 rounded-lg text-red-600 transition-colors font-medium text-xs"
                            >
                              Cancel
                            </button>
                          </>
                        )}
                        {po.status === "approved" && (
                          <button
                            onClick={() => sendMutation.mutate(po.id)}
                            className="px-2 py-1 hover:bg-emerald-50 rounded-lg text-emerald-600 transition-colors font-medium text-xs flex items-center gap-1"
                          >
                            <Send className="w-3.5 h-3.5" /> Send
                          </button>
                        )}
                        {(po.status === "sent" || po.status === "partially_received") && (
                          <button
                            onClick={() => setGrnPO({ id: po.id, poNumber: po.poNumber })}
                            className="px-2 py-1 hover:bg-green-50 rounded-lg text-green-700 transition-colors font-medium text-xs flex items-center gap-1"
                          >
                            <PackageCheck className="w-3.5 h-3.5" />
                            {po.status === "partially_received" ? "Receive More" : "Receive"}
                          </button>
                        )}
                        {isAdmin && (
                          confirmDeleteId === po.id ? (
                            <span className="flex items-center gap-1">
                              <button
                                onClick={() => deletePOMutation.mutate(po.id)}
                                disabled={deletePOMutation.isPending}
                                className="text-xs text-red-600 font-semibold hover:underline disabled:opacity-60"
                              >
                                {deletePOMutation.isPending ? "..." : "Confirm"}
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                className="text-xs text-muted-foreground hover:underline"
                              >
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <button
                              onClick={() => setConfirmDeleteId(po.id)}
                              className="p-1.5 hover:bg-red-50 rounded-lg transition-colors text-muted-foreground hover:text-red-600"
                              title="Delete PO"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* GRN Modal */}
      {grnPO && (
        <GrnModal
          poId={grnPO.id}
          poNumber={grnPO.poNumber}
          open={!!grnPO}
          onClose={() => setGrnPO(null)}
        />
      )}

      {/* Draft PO Modal */}
      <Modal
        title={editingPO ? "Edit Purchase Order" : "Create Draft Purchase Order"}
        subtitle={editingPO ? `Editing purchase order: ${editingPO.poNumber}` : "Draft a new purchase order for supplier review"}
        open={isOpen}
        onClose={handleClose}
        size="xl"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold">Supplier *</label>
              <select
                required
                value={form.supplierId}
                onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
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
                className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
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
                className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold">Notes</label>
              <input
                type="text"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              />
            </div>
          </div>

          <div className="border-t pt-4">
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-semibold text-slate-700">Order Items *</label>
              <button
                type="button"
                onClick={handleAddItem}
                className="text-xs font-bold text-emerald-600 hover:underline"
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
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 transition-colors shadow-sm"
            >
              {(createPOMutation.isPending || updatePOMutation.isPending) ? "Saving..." : editingPO ? "Save Changes" : "Save Draft"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
