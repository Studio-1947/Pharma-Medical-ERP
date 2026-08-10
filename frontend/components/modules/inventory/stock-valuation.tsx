"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, TrendingUp, Package, IndianRupee, BarChart2 } from "lucide-react";
import { apiClient } from "@/lib/api-client";

interface ValuationRow {
  id: string;
  name: string;
  sku: string;
  scheduleClass: string | null;
  totalQty: number;
  costValue: number;
  mrpValue: number;
  batchCount: number;
}

function fmt(n: number) {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
}

const SCHEDULE_COLORS: Record<string, string> = {
  SCHEDULE_H: "bg-orange-100 text-orange-700",
  SCHEDULE_H1: "bg-red-100 text-red-700",
  SCHEDULE_X: "bg-teal-100 text-teal-700",
  OTC: "bg-green-100 text-green-700",
};

export function StockValuation() {
  const [search, setSearch] = useState("");

  const { data, isLoading, isError } = useQuery<{ data: ValuationRow[] }>({
    queryKey: ["stock-valuation"],
    queryFn: () =>
      apiClient.get("/inventory/medicines/valuation") as Promise<{ data: ValuationRow[] }>,
  });

  const rows: ValuationRow[] = data?.data ?? [];

  const filtered = rows.filter(
    (r) =>
      !search ||
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.sku.toLowerCase().includes(search.toLowerCase()),
  );

  const totalCost = filtered.reduce((s, r) => s + Number(r.costValue), 0);
  const totalMrp = filtered.reduce((s, r) => s + Number(r.mrpValue), 0);
  const totalQty = filtered.reduce((s, r) => s + Number(r.totalQty), 0);
  const margin = totalMrp > 0 ? ((totalMrp - totalCost) / totalMrp) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-xl border bg-white p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600 shrink-0">
            <IndianRupee size={16} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Cost Value</p>
            <p className="text-lg font-bold text-slate-800">{fmt(totalCost)}</p>
          </div>
        </div>
        <div className="rounded-xl border bg-white p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-green-50 flex items-center justify-center text-green-600 shrink-0">
            <TrendingUp size={16} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">MRP Value</p>
            <p className="text-lg font-bold text-slate-800">{fmt(totalMrp)}</p>
          </div>
        </div>
        <div className="rounded-xl border bg-white p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600 shrink-0">
            <BarChart2 size={16} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Gross Margin</p>
            <p className="text-lg font-bold text-slate-800">{margin.toFixed(1)}%</p>
          </div>
        </div>
        <div className="rounded-xl border bg-white p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-teal-50 flex items-center justify-center text-teal-600 shrink-0">
            <Package size={16} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total Units</p>
            <p className="text-lg font-bold text-slate-800">
              {totalQty.toLocaleString("en-IN")}
            </p>
          </div>
        </div>
      </div>

      {/* Filter */}
      <div className="relative max-w-sm">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="text"
          placeholder="Filter by name or SKU..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {isLoading && (
        <div className="text-center py-16 text-muted-foreground">Loading valuation...</div>
      )}
      {isError && (
        <div className="text-center py-16 text-red-500">Failed to load stock valuation.</div>
      )}

      {!isLoading && !isError && (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Medicine</th>
                <th className="text-left px-4 py-3 font-medium">SKU</th>
                <th className="text-center px-4 py-3 font-medium">Schedule</th>
                <th className="text-right px-4 py-3 font-medium">Qty</th>
                <th className="text-right px-4 py-3 font-medium">Batches</th>
                <th className="text-right px-4 py-3 font-medium">Cost Value</th>
                <th className="text-right px-4 py-3 font-medium">MRP Value</th>
                <th className="text-right px-4 py-3 font-medium">Margin</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((r) => {
                const rowMargin =
                  r.mrpValue > 0
                    ? ((r.mrpValue - r.costValue) / r.mrpValue) * 100
                    : 0;
                return (
                  <tr key={r.id} className="hover:bg-muted/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-800">{r.name}</td>
                    <td className="px-4 py-3 font-mono text-xs">{r.sku}</td>
                    <td className="px-4 py-3 text-center">
                      {r.scheduleClass ? (
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                            SCHEDULE_COLORS[r.scheduleClass] ?? "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {r.scheduleClass.replace("SCHEDULE_", "")}
                        </span>
                      ) : (
                        <span className="text-xs text-green-600 font-medium">OTC</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {Number(r.totalQty).toLocaleString("en-IN")}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {r.batchCount}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      {fmt(Number(r.costValue))}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-emerald-600">
                      {fmt(Number(r.mrpValue))}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={`text-xs font-bold ${
                          rowMargin >= 20
                            ? "text-green-600"
                            : rowMargin >= 10
                            ? "text-amber-600"
                            : "text-red-500"
                        }`}
                      >
                        {rowMargin.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-16 text-muted-foreground">
                    {rows.length === 0 ? "No stock data available." : "No matches found."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
