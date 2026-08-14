"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Pill, Package, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { apiClient, queryKeys } from "@/lib/api-client";
import { useActiveBranchId } from "@/hooks/use-branch";
import { formatStockUnit } from "@/lib/stock-unit-formatter";

/**
 * OTC supply — hand a medicine over from the counter WITHOUT billing.
 *
 * Stock is decremented and a ledger movement is logged so the supply is
 * traceable, but no invoice is generated. Used from both the patient-first
 * counter desk and the classic POS search results (common need).
 */
export function OtcSupplyModal({
  medicine,
  onClose,
}: {
  medicine: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { branchId: activeBranchId } = useActiveBranchId();
  const { success: toastSuccess, error: toastError } = useToast();
  const [batchId, setBatchId] = useState<string>("");
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");

  const open = !!medicine;

  const { data: batchesRaw, isLoading } = useQuery({
    queryKey: ["otc-supply-batches", medicine?.id, activeBranchId],
    queryFn: () =>
      apiClient.get(`/inventory/medicines/${medicine!.id}/batches`, {
        params: { branchId: activeBranchId },
      }) as any,
    enabled: open,
  });

  const batches: any[] = (() => {
    const raw = batchesRaw as any;
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw?.data?.data)) return raw.data.data;
    if (Array.isArray(raw?.data)) return raw.data;
    return [];
  })();

  const selectedBatch = batches.find((b) => b.id === batchId) ?? batches[0] ?? null;

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post(`/inventory/batches/${batchId}/otc-supply`, {
        quantity,
        branchId: activeBranchId,
        notes: notes.trim() || undefined,
      }) as any,
    onSuccess: (res: any) => {
      const data = res?.data ?? res;
      qc.invalidateQueries({ queryKey: ["otc-supply-batches"] });
      qc.invalidateQueries({ queryKey: ["counter-low-stock"] });
      qc.invalidateQueries({ queryKey: ["medicine-batches-detail"] });
      qc.invalidateQueries({ queryKey: queryKeys.medicines.list({}) });
      toastSuccess(
        "OTC supply recorded",
        `${data?.quantitySupplied ?? quantity} unit(s) of ${medicine?.name ?? "medicine"} handed out — no bill generated.`,
      );
      onClose();
    },
    onError: (err: any) => {
      toastError(
        "Supply failed",
        err?.response?.data?.message ?? "Could not record the OTC supply.",
      );
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!batchId && !selectedBatch) return;
    const id = batchId || selectedBatch.id;
    setBatchId(id);
    mutation.mutate();
  };

  const maxQty = Number(selectedBatch?.quantity ?? 0);

  return (
    <Modal
      title="OTC Supply — No Bill"
      subtitle={`${medicine?.name ?? "Medicine"} — record a supply without generating an invoice`}
      icon={<Pill size={16} />}
      open={open}
      onClose={onClose}
      size="md"
    >
      {!medicine ? null : (
        <div className="space-y-4">
          <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>
              Stock is deducted and the supply is recorded in the movement
              ledger, but no bill or payment is created. Use this for free /
              counter samples and OTC hand-outs.
            </span>
          </div>

          {isLoading ? (
            <div className="py-10 text-center text-xs text-slate-400 animate-pulse">
              Loading active batches…
            </div>
          ) : batches.length === 0 ? (
            <div className="py-10 text-center">
              <Package size={26} className="mx-auto text-slate-300" />
              <p className="mt-2 text-sm font-semibold text-slate-600">
                No active stock found
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Receive stock for this medicine before recording an OTC supply.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Batch picker */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Batch (FEFO order — earliest expiry first)
                </label>
                <select
                  value={batchId || selectedBatch?.id || ""}
                  onChange={(e) => setBatchId(e.target.value)}
                  required
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/30"
                >
                  {batches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.batchNo} — {formatStockUnit(Number(b.quantity ?? 0), {})} available
                      {b.expiryDate ? ` · exp ${b.expiryDate.slice(0, 7)}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* Quantity */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Quantity to supply
                </label>
                <input
                  type="number"
                  min={1}
                  max={maxQty || undefined}
                  value={quantity}
                  onChange={(e) =>
                    setQuantity(
                      Math.min(maxQty || 1, Math.max(1, Number(e.target.value) || 1)),
                    )
                  }
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/30"
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Max {maxQty} unit{maxQty === 1 ? "" : "s"} on this batch
                </p>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Notes <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. free sample, staff medicine, counter hand-out…"
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/30"
                />
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={mutation.isPending || maxQty <= 0}
                  className="flex items-center gap-2 px-5 py-2 bg-orange-500 hover:bg-orange-600 text-white text-xs font-extrabold rounded-lg disabled:opacity-50 transition-colors shadow-sm"
                >
                  {mutation.isPending ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Recording…
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={14} />
                      Record OTC Supply
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </Modal>
  );
}
