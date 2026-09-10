"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, PackagePlus, Pill } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { apiClient } from "@/lib/api-client";
import { useActiveBranchId } from "@/hooks/use-branch";
import { usePermissions } from "@/hooks/use-permissions";
import { canSellLooseUnits, formatStockUnit } from "@/lib/stock-unit-formatter";
import { MedicineStockModal } from "@/components/modules/inventory/medicine-stock-modal";

export function MedicineBatchPickerModal({
  medicine,
  onClose,
  onAdd,
}: {
  medicine: any | null;
  onClose: () => void;
  onAdd: (batch: any, quantity: number) => void;
}) {
  const { branchId } = useActiveBranchId();
  const { can } = usePermissions();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [restockOpen, setRestockOpen] = useState(false);

  useEffect(() => {
    setSelectedId("");
    setQuantity(1);
  }, [medicine?.id]);

  const { data, isLoading } = useQuery({
    queryKey: ["counter-batch-picker", medicine?.id, branchId],
    queryFn: () =>
      apiClient.get(`/inventory/medicines/${medicine.id}/batches`, {
        params: { branchId },
      }) as any,
    enabled: !!medicine?.id,
  });
  const batches: any[] = Array.isArray((data as any)?.data?.data)
    ? (data as any).data.data
    : Array.isArray((data as any)?.data)
      ? (data as any).data
      : Array.isArray(data)
        ? (data as any[])
        : [];
  const selected = batches.find((b) => b.id === selectedId) ?? null;
  const stripSize = Math.max(1, Number(medicine?.stripSize ?? 1) || 1);
  const unitInfo = {
    unit: medicine?.unit ?? null,
    dosageForm: medicine?.dosageForm ?? null,
    stripSize,
  };
  const unitsPerPack = canSellLooseUnits(unitInfo) ? stripSize : 1;
  const selectedStock = selected
    ? Math.max(0, Number(selected.quantity ?? 0) - Number(selected.reservedQty ?? 0))
    : 0;
  const maxPacks = Math.floor(selectedStock / unitsPerPack);

  return (
    <>
      <Modal
        title="Select physical batch"
        subtitle={`${medicine?.name ?? "Medicine"}${medicine?.sku ? ` · ${medicine.sku}` : ""}`}
        icon={<Pill size={16} />}
        open={!!medicine}
        onClose={onClose}
        size="2xl"
      >
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
            <div>
              <p className="text-sm font-bold text-blue-950">Match the pack in your hand</p>
              <p className="mt-0.5 text-xs text-blue-700">Choose its batch below. Only that batch, stock and price will be added to the bill.</p>
            </div>
            {can("inventory.write") && (
              <button type="button" onClick={() => setRestockOpen(true)} className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-orange-500 px-3 py-2 text-xs font-extrabold text-white hover:bg-orange-600">
                <PackagePlus size={13} /> Receive new batch
              </button>
            )}
          </div>

          {isLoading ? (
            <div className="py-12 text-center text-sm text-slate-400 animate-pulse">Loading physical batches…</div>
          ) : batches.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 py-12 text-center text-sm text-slate-500">No sellable batch is available in this branch.</div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {batches.map((b) => {
                const stock = Math.max(0, Number(b.quantity ?? 0) - Number(b.reservedQty ?? 0));
                const active = selectedId === b.id;
                return (
                  <button
                    key={b.id}
                    type="button"
                    aria-label={`Select batch ${b.batchNo}`}
                    aria-pressed={active}
                    onClick={() => { setSelectedId(b.id); setQuantity(1); }}
                    className={`rounded-2xl border p-4 text-left transition-all ${active ? "border-orange-500 bg-orange-50 ring-2 ring-orange-200" : "border-slate-200 bg-white hover:border-orange-300 hover:shadow-sm"}`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm font-black text-slate-900">{b.batchNo}</span>
                      <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-extrabold text-emerald-700">{formatStockUnit(stock, unitInfo)}</span>
                    </span>
                    <span className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                      <span className="text-slate-400">Cost price</span><span className="text-right font-semibold text-slate-700">₹{Number(b.costPrice ?? 0).toFixed(2)}</span>
                      <span className="text-slate-400">Selling / MRP</span><span className="text-right font-black text-slate-900">₹{Number(b.mrpAtEntry ?? 0).toFixed(2)}</span>
                      <span className="text-slate-400">Manufactured</span><span className="text-right font-semibold text-slate-700">{b.manufactureDate ? String(b.manufactureDate).slice(0, 10) : "--"}</span>
                      <span className="text-slate-400">Expiry</span><span className="text-right font-semibold text-slate-700">{b.expiryDate ? String(b.expiryDate).slice(0, 10) : "--"}</span>
                      <span className="text-slate-400">Received</span><span className="text-right font-semibold text-slate-700">{b.createdAt ? String(b.createdAt).slice(0, 10) : "--"}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="w-full sm:max-w-xs">
              <label htmlFor="batch-picker-quantity" className="text-xs font-bold text-slate-700">Quantity ({medicine?.unit || "pack"})</label>
              <input id="batch-picker-quantity" type="number" min={1} max={Math.max(1, maxPacks)} disabled={!selected} value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-100 disabled:opacity-50" />
              <p className="mt-1 text-[11px] text-slate-400">{selected ? `Maximum ${maxPacks} from this batch` : "Select a batch first"}</p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100">Cancel</button>
              <button type="button" disabled={!selected || quantity > maxPacks} onClick={() => { if (selected) onAdd(selected, quantity); }} className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-extrabold text-white hover:bg-emerald-700 disabled:opacity-50">Add selected batch to bill</button>
            </div>
          </div>
        </div>
      </Modal>

      <MedicineStockModal
        open={restockOpen}
        onClose={() => {
          setRestockOpen(false);
          void qc.invalidateQueries({ queryKey: ["counter-batch-picker", medicine?.id, branchId] });
        }}
        medicineId={medicine?.id ?? null}
        medicineName={medicine?.name}
        autoOpenAddStock
      />
    </>
  );
}
