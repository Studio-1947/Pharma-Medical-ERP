"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Clock, Package } from "lucide-react";
import { apiClient } from "@/lib/api-client";

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

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-8">
      {/* Low stock widget */}
      <div className="rounded-xl border bg-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Package size={18} className="text-amber-500" />
          <h3 className="font-semibold">Low Stock Alerts</h3>
          {lowStock.length > 0 && (
            <span className="ml-auto bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full">
              {lowStock.length}
            </span>
          )}
        </div>
        {lowStock.length === 0 ? (
          <p className="text-sm text-muted-foreground">All stock levels are healthy.</p>
        ) : (
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {lowStock.slice(0, 15).map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between text-sm py-1.5 border-b last:border-0"
              >
                <div>
                  <span className="font-medium">{item.name}</span>
                  <span className="text-muted-foreground text-xs ml-2">({item.sku})</span>
                </div>
                <div className="text-right">
                  <span
                    className={`font-bold ${
                      item.current_stock === 0 ? "text-red-600" : "text-amber-600"
                    }`}
                  >
                    {item.current_stock}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {" "}
                    / {item.reorder_level} min
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Expiring soon widget */}
      <div className="rounded-xl border bg-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Clock size={18} className="text-red-500" />
          <h3 className="font-semibold">Expiring Within 30 Days</h3>
          {expiring.length > 0 && (
            <span className="ml-auto bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">
              {expiring.length}
            </span>
          )}
        </div>
        {expiring.length === 0 ? (
          <p className="text-sm text-muted-foreground">No batches expiring in 30 days.</p>
        ) : (
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {expiring.slice(0, 15).map((b) => {
              const days = Math.ceil(
                (new Date(b.expiryDate).getTime() - Date.now()) / 86_400_000,
              );
              return (
                <div
                  key={b.id}
                  className="flex items-center justify-between text-sm py-1.5 border-b last:border-0"
                >
                  <div className="flex items-center gap-2">
                    <AlertTriangle
                      size={14}
                      className={days <= 7 ? "text-red-500 shrink-0" : "text-amber-500 shrink-0"}
                    />
                    <div className="min-w-0">
                      <p className="font-semibold text-xs text-slate-800 truncate max-w-[180px]">
                        {(b as any).medicineName ?? (b as any).medicine?.name ?? `Batch ${b.batchNo}`}
                      </p>
                      <p className="font-mono text-[10px] text-slate-400">
                        {b.batchNo}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span
                      className={`font-bold text-xs ${
                        days <= 7 ? "text-red-600" : "text-amber-600"
                      }`}
                    >
                      {days}d
                    </span>
                    <span className="text-muted-foreground text-xs ml-1">
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
  );
}
