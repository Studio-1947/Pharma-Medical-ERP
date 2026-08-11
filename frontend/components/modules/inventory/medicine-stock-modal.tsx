"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Pill,
  Package,
  Plus,
  Printer,
  Calendar,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Barcode,
  Layers,
  ArrowRight,
  TrendingDown,
  X,
  PlusCircle,
} from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { apiClient, queryKeys } from "@/lib/api-client";
import { useActiveBranchId } from "@/hooks/use-branch";
import { BarcodeLabelModal } from "./barcode-label-modal";

interface Props {
  open: boolean;
  onClose: () => void;
  medicineId: string | null;
  medicineName?: string;
}

export function MedicineStockModal({ open, onClose, medicineId, medicineName }: Props) {
  const { branchId: activeBranchId } = useActiveBranchId();
  const { success: toastSuccess, error: toastError } = useToast();
  const queryClient = useQueryClient();

  const [addStockOpen, setAddStockOpen] = useState(false);
  const [selectedBatchForLabel, setSelectedBatchForLabel] = useState<string | null>(null);

  // New batch form state
  const [newBatchNo, setNewBatchNo] = useState("");
  const [newExpiry, setNewExpiry] = useState("");
  const [newQty, setNewQty] = useState<number>(50);
  const [newPurchasePrice, setNewPurchasePrice] = useState<string>("");
  const [newMrp, setNewMrp] = useState<string>("");

  // 1. Fetch medicine profile
  const { data: medicineRes, isLoading: loadingMed } = useQuery({
    queryKey: ["medicine-detail", medicineId],
    queryFn: () => apiClient.get(`/inventory/medicines/${medicineId}`) as any,
    enabled: open && !!medicineId,
  });

  // 2. Fetch active batches for this medicine
  const { data: batchesRes, isLoading: loadingBatches } = useQuery({
    queryKey: ["medicine-batches-detail", medicineId, activeBranchId],
    queryFn: () =>
      apiClient.get(`/inventory/medicines/${medicineId}/batches`, {
        params: { branchId: activeBranchId },
      }) as any,
    enabled: open && !!medicineId,
  });

  const medicine: any = medicineRes?.data ?? medicineRes ?? null;
  const batches: any[] = Array.isArray(batchesRes)
    ? batchesRes
    : Array.isArray(batchesRes?.data?.data)
      ? batchesRes.data.data
      : Array.isArray(batchesRes?.data)
        ? batchesRes.data
        : [];

  const totalStock = batches.reduce((sum, b) => sum + (b.quantity ?? 0), 0);

  // Add batch mutation
  const addBatchMutation = useMutation({
    mutationFn: (payload: object) => apiClient.post("/inventory/batches", payload) as any,
    onSuccess: () => {
      toastSuccess("Stock Added", `Successfully added new batch to ${medicine?.name ?? "inventory"}.`);
      queryClient.invalidateQueries({ queryKey: ["medicine-batches-detail", medicineId] });
      queryClient.invalidateQueries({ queryKey: ["low-stock"] });
      queryClient.invalidateQueries({ queryKey: ["expiring-batches"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.medicines.list({}) });
      setAddStockOpen(false);
      setNewBatchNo("");
      setNewExpiry("");
      setNewQty(50);
      setNewPurchasePrice("");
      setNewMrp("");
    },
    onError: (err: any) => {
      toastError("Failed to add stock", err?.response?.data?.message ?? "Could not receive new batch.");
    },
  });

  const handleAddStockSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!medicineId || !newBatchNo.trim() || !newExpiry) return;

    const cost = parseFloat(newPurchasePrice || medicine?.purchasePrice || "0").toFixed(2);
    const mrp = parseFloat(newMrp || medicine?.priceMrp || "0").toFixed(2);

    addBatchMutation.mutate({
      medicineId,
      branchId: activeBranchId,
      batchNo: newBatchNo.trim().toUpperCase(),
      expiryDate: newExpiry, // YYYY-MM-DD format
      quantity: Number(newQty),
      costPrice: cost,
      mrpAtEntry: mrp,
    });
  };

  if (!open || !medicineId) return null;

  return (
    <>
      <Modal
        title={medicine?.name ?? medicineName ?? "Medicine Stock Overview"}
        subtitle={`SKU: ${medicine?.sku ?? "—"} • Direct Batch & Stock Management`}
        icon={<Pill size={18} />}
        open={open}
        onClose={onClose}
        size="xl"
      >
        <div className="space-y-5">
          {/* Header Metadata Pill */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5">
            <div className="space-y-0.5">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Total Stock</span>
              <div className="flex items-center gap-1.5">
                <Package size={16} className="text-emerald-600" />
                <span className={`text-base font-extrabold ${totalStock <= (medicine?.reorderLevel ?? 10) ? "text-amber-600" : "text-slate-900"}`}>
                  {totalStock} units
                </span>
              </div>
            </div>
            <div className="space-y-0.5">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Reorder Level</span>
              <p className="text-base font-extrabold text-slate-700">
                {medicine?.reorderLevel ?? 10} min
              </p>
            </div>
            <div className="space-y-0.5">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Unit MRP</span>
              <p className="text-base font-extrabold text-emerald-600">
                ₹{parseFloat(medicine?.priceMrp ?? "0").toFixed(2)}
              </p>
            </div>
            <div className="space-y-0.5">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Schedule Class</span>
              <div>
                {medicine?.scheduleClass ? (
                  <span className="inline-block px-2 py-0.5 rounded text-xs font-extrabold bg-rose-100 text-rose-700 border border-rose-200">
                    {medicine.scheduleClass}
                  </span>
                ) : medicine?.requiresPrescription ? (
                  <span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-700">
                    Rx Required
                  </span>
                ) : (
                  <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-slate-200 text-slate-700">
                    OTC
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Action Bar */}
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Layers size={14} className="text-emerald-600" />
              <span>Active Batches ({batches.length})</span>
            </h4>
            <button
              onClick={() => {
                setNewPurchasePrice(medicine?.purchasePrice ?? "");
                setNewMrp(medicine?.priceMrp ?? "");
                setAddStockOpen((prev) => !prev);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all"
            >
              <PlusCircle size={14} />
              <span>{addStockOpen ? "Cancel Form" : "Add Stock / Batch"}</span>
            </button>
          </div>

          {/* Inline Stock Addition Form */}
          {addStockOpen && (
            <form onSubmit={handleAddStockSubmit} className="bg-emerald-50/60 border border-emerald-200/80 rounded-2xl p-4 space-y-4 animate-in fade-in duration-150">
              <div className="flex items-center justify-between border-b border-emerald-200/60 pb-2">
                <span className="text-xs font-extrabold text-emerald-900 flex items-center gap-1.5">
                  <Plus size={14} /> Direct Receive Batch & Stock
                </span>
                <span className="text-[11px] text-emerald-700 font-medium">Instantly updates branch inventory</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Batch No *</label>
                  <input
                    required
                    placeholder="e.g. BATCH-992"
                    value={newBatchNo}
                    onChange={(e) => setNewBatchNo(e.target.value)}
                    className="w-full text-xs font-mono font-bold bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Expiry Date *</label>
                  <input
                    required
                    type="date"
                    value={newExpiry}
                    onChange={(e) => setNewExpiry(e.target.value)}
                    className="w-full text-xs font-semibold bg-white border border-slate-200 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Received Qty *</label>
                  <input
                    required
                    type="number"
                    min={1}
                    value={newQty}
                    onChange={(e) => setNewQty(parseInt(e.target.value) || 1)}
                    className="w-full text-xs font-bold bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">MRP (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder={medicine?.priceMrp ?? "0.00"}
                    value={newMrp}
                    onChange={(e) => setNewMrp(e.target.value)}
                    className="w-full text-xs font-bold text-emerald-700 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setAddStockOpen(false)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addBatchMutation.isPending}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-extrabold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                >
                  {addBatchMutation.isPending ? "Receiving..." : "Confirm Receive Stock"}
                </button>
              </div>
            </form>
          )}

          {/* Batches Table */}
          <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
            {loadingBatches ? (
              <div className="py-12 text-center text-xs text-slate-400 animate-pulse">
                Loading active stock batches...
              </div>
            ) : batches.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-400 space-y-2">
                <Package size={28} className="mx-auto opacity-30 text-amber-500" />
                <p className="font-semibold text-slate-600">No active stock batches found for this medicine.</p>
                <p className="text-[11px] text-slate-400">Click &ldquo;Add Stock / Batch&rdquo; above to receive inventory.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-2.5 text-left">Batch No</th>
                      <th className="px-4 py-2.5 text-left">Expiry Date</th>
                      <th className="px-4 py-2.5 text-right">Available Qty</th>
                      <th className="px-4 py-2.5 text-right">MRP</th>
                      <th className="px-4 py-2.5 text-center">Status</th>
                      <th className="px-4 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {batches.map((b) => {
                      const days = Math.ceil(
                        (new Date(b.expiryDate).getTime() - Date.now()) / 86_400_000
                      );
                      const isExpiringSoon = days <= 30;
                      const isExpired = days <= 0;

                      return (
                        <tr key={b.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="px-4 py-3 font-mono font-bold text-slate-900">
                            {b.batchNo}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <Calendar size={13} className="text-slate-400" />
                              <span className="font-medium text-slate-700">
                                {new Date(b.expiryDate).toLocaleDateString("en-IN", {
                                  month: "short",
                                  year: "numeric",
                                })}
                              </span>
                              <span
                                className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                                  isExpired
                                    ? "bg-red-100 text-red-700 border border-red-200"
                                    : isExpiringSoon
                                      ? "bg-amber-100 text-amber-800 border border-amber-200"
                                      : "bg-emerald-50 text-emerald-700"
                                }`}
                              >
                                {isExpired ? "EXPIRED" : `${days}d left`}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-extrabold text-slate-900">
                            {b.quantity}
                          </td>
                          <td className="px-4 py-3 text-right font-bold text-emerald-600">
                            ₹{parseFloat(b.mrp ?? medicine?.priceMrp ?? "0").toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span
                              className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                b.status === "ACTIVE"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-amber-100 text-amber-800"
                              }`}
                            >
                              {b.status ?? "ACTIVE"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => setSelectedBatchForLabel(b.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-bold transition-colors shadow-2xs"
                              title="Print 50mm x 25mm barcode shelf sticker"
                            >
                              <Barcode size={12} />
                              <span>Sticker</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* Barcode label modal */}
      {selectedBatchForLabel && (
        <BarcodeLabelModal
          open={!!selectedBatchForLabel}
          onClose={() => setSelectedBatchForLabel(null)}
          batchId={selectedBatchForLabel}
        />
      )}
    </>
  );
}
