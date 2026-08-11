"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Clock, Package, Layers, ArrowUpRight } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { MedicineStockModal } from "./medicine-stock-modal";

interface LowStockRow {
  id: string;
  name: string;
  sku: string;
  reorder_level: number;
  current_stock: number;
}

interface ExpiringBatch {
  id: string;
  medicineId: string;
  batchNo: string;
  expiryDate: string;
  quantity: number;
  status: string;
}

export function StockDashboard() {
  const [selectedMedicineId, setSelectedMedicineId] = useState<string | null>(null);
  const [selectedMedicineName, setSelectedMedicineName] = useState<string | undefined>(undefined);

  const { data: lowStockRaw } = useQuery({
    queryKey: ["low-stock"],
    queryFn: () => apiClient.get("/inventory/medicines/low-stock") as any,
    refetchInterval: 60_000,
  });

  const { data: expiringRaw } = useQuery({
    queryKey: ["expiring-batches", 30],
    queryFn: () =>
      apiClient.get("/inventory/batches/expiring", { params: { days: 30 } }) as any,
    refetchInterval: 60_000,
  });

  const lowStock: LowStockRow[] = lowStockRaw?.data ?? lowStockRaw?.rows ?? [];
  const expiring: ExpiringBatch[] = expiringRaw?.data ?? [];

  const handleOpenMedicine = (id: string, name?: string) => {
    setSelectedMedicineId(id);
    setSelectedMedicineName(name);
  };

  return (
    <>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-8">
        {/* Low stock widget */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs flex flex-col">
          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-100">
            <div className="w-8 h-8 rounded-xl bg-amber-50 border border-amber-200/60 flex items-center justify-center text-amber-600">
              <Package size={17} />
            </div>
            <div>
              <h3 className="font-extrabold text-slate-900 text-sm">Low Stock Alerts</h3>
              <p className="text-[11px] text-slate-400 font-medium">Click any medicine to manage stock & add batches directly</p>
            </div>
            {lowStock.length > 0 && (
              <span className="ml-auto bg-amber-100 text-amber-800 text-xs font-extrabold px-2.5 py-0.5 rounded-full border border-amber-200">
                {lowStock.length}
              </span>
            )}
          </div>
          {lowStock.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">All stock levels are healthy.</div>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {lowStock.slice(0, 15).map((item) => (
                <div
                  key={item.id}
                  onClick={() => handleOpenMedicine(item.id, item.name)}
                  className="flex items-center justify-between text-sm py-2 px-3 rounded-xl border border-transparent hover:border-amber-200/80 hover:bg-amber-50/50 cursor-pointer transition-all duration-150 group"
                >
                  <div className="min-w-0 flex-1 pr-3">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-xs text-slate-800 group-hover:text-amber-900 truncate">
                        {item.name}
                      </span>
                      <ArrowUpRight size={13} className="text-slate-300 group-hover:text-amber-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </div>
                    <span className="text-[10px] font-mono text-slate-400">({item.sku})</span>
                  </div>
                  <div className="text-right shrink-0">
                    <span
                      className={`font-extrabold text-xs px-2 py-0.5 rounded-md ${
                        item.current_stock === 0
                          ? "bg-rose-100 text-rose-700 border border-rose-200"
                          : "bg-amber-100 text-amber-800 border border-amber-200"
                      }`}
                    >
                      {item.current_stock}
                    </span>
                    <span className="text-slate-400 text-xs font-semibold ml-1">
                      / {item.reorder_level} min
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Expiring soon widget */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs flex flex-col">
          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-100">
            <div className="w-8 h-8 rounded-xl bg-rose-50 border border-rose-200/60 flex items-center justify-center text-rose-600">
              <Clock size={17} />
            </div>
            <div>
              <h3 className="font-extrabold text-slate-900 text-sm">Expiring Within 30 Days</h3>
              <p className="text-[11px] text-slate-400 font-medium">Click batch to view details, replace stock, or print stickers</p>
            </div>
            {expiring.length > 0 && (
              <span className="ml-auto bg-rose-100 text-rose-800 text-xs font-extrabold px-2.5 py-0.5 rounded-full border border-rose-200">
                {expiring.length}
              </span>
            )}
          </div>
          {expiring.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">No batches expiring in 30 days.</div>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {expiring.slice(0, 15).map((b) => {
                const days = Math.ceil(
                  (new Date(b.expiryDate).getTime() - Date.now()) / 86_400_000,
                );
                const medId = b.medicineId || (b as any).medicine?.id;
                const medName = (b as any).medicineName ?? (b as any).medicine?.name ?? `Batch ${b.batchNo}`;

                return (
                  <div
                    key={b.id}
                    onClick={() => medId && handleOpenMedicine(medId, medName)}
                    className="flex items-center justify-between text-sm py-2 px-3 rounded-xl border border-transparent hover:border-rose-200/80 hover:bg-rose-50/50 cursor-pointer transition-all duration-150 group"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1 pr-3">
                      <AlertTriangle
                        size={14}
                        className={days <= 7 ? "text-rose-500 shrink-0 animate-pulse" : "text-amber-500 shrink-0"}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1">
                          <p className="font-bold text-xs text-slate-800 group-hover:text-rose-900 truncate">
                            {medName}
                          </p>
                          <ArrowUpRight size={13} className="text-slate-300 group-hover:text-rose-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                        </div>
                        <p className="font-mono text-[10px] text-slate-400">
                          Batch: {b.batchNo}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span
                        className={`font-extrabold text-xs px-2 py-0.5 rounded-md ${
                          days <= 7 ? "bg-rose-100 text-rose-700 border border-rose-200" : "bg-amber-100 text-amber-800 border border-amber-200"
                        }`}
                      >
                        {days}d
                      </span>
                      <span className="text-slate-500 text-xs font-semibold ml-1">
                        &bull; qty {b.quantity}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Quick Stock & Batch Modal */}
      <MedicineStockModal
        open={!!selectedMedicineId}
        onClose={() => setSelectedMedicineId(null)}
        medicineId={selectedMedicineId}
        medicineName={selectedMedicineName}
      />
    </>
  );
}
