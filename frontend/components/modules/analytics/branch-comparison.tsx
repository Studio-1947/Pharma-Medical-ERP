"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Building2, AlertTriangle } from "lucide-react";

/**
 * Branches side by side, plus consolidated totals.
 *
 * The table is the primary form: this screen exists to compare exact figures
 * across a handful of branches, which a reader does by reading numbers, not by
 * estimating bar lengths. The chart carries only the headline measure —
 * revenue — as a single series, so it needs no legend and no second axis.
 */

interface BranchRow {
  branchId: string;
  branchName: string;
  branchCode: string;
  isActive: boolean;
  revenue: number;
  invoices: number;
  avgInvoiceValue: number;
  units: number;
  stockValue: number;
  batches: number;
  expiringSoon: number;
}

const RANGES = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
] as const;

function inr(n: number) {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
}

function num(n: number) {
  return n.toLocaleString("en-IN");
}

export function BranchComparison() {
  const [days, setDays] = useState<number>(30);

  const to = new Date().toISOString().slice(0, 10);
  const from = (() => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  })();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["branch-comparison", from, to],
    queryFn: () =>
      apiClient.get("/reports/branch-comparison", {
        params: { from, to },
      }) as Promise<any>,
  });

  const payload = (data as any)?.data ?? data;
  const rows: BranchRow[] = payload?.rows ?? [];
  const totals = payload?.totals;

  // Bars are scaled against the largest branch, not the total — comparing
  // branches to each other is the whole point of the screen.
  const maxRevenue = Math.max(1, ...rows.map((r) => r.revenue));

  if (isError) {
    return (
      <div className="flex items-start gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
        <AlertTriangle size={15} className="shrink-0 mt-0.5" />
        <div>
          <p className="font-medium">Could not load branch comparison</p>
          <p className="text-xs text-red-600/80 mt-0.5">
            {(error as any)?.response?.data?.message ??
              "This report is available to super admins and admins."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="viz-root space-y-5">
      <style>{`
        .viz-root {
          --series-1: #059669;
          --grid: #e1e0d9;
          --muted: #898781;
        }
      `}</style>

      {/* Filters sit in one row above the charts */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-slate-800">Branch Comparison</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {from} to {to}
          </p>
        </div>
        <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.days}
              onClick={() => setDays(r.days)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                days === r.days
                  ? "bg-white text-slate-800 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2 animate-pulse">
          <div className="h-44 bg-slate-100 rounded-xl" />
          <div className="h-56 bg-slate-100 rounded-xl" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white py-12 text-center">
          <Building2 className="mx-auto text-slate-300" size={28} />
          <p className="text-sm text-slate-500 mt-2">No branches configured.</p>
        </div>
      ) : (
        <>
          {/* Revenue by branch — single series, so the title names it and no
              legend is needed. Values are direct-labelled rather than relying
              on an axis readout. */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h4 className="text-sm font-semibold text-slate-800">
              Revenue by branch
            </h4>
            <p className="text-xs text-slate-400 mt-0.5 mb-4">
              Confirmed invoices in the selected range
            </p>

            <div className="space-y-3">
              {rows.map((r) => (
                <div key={r.branchId} className="flex items-center gap-3">
                  <div className="w-32 shrink-0 min-w-0">
                    <p className="text-xs font-medium text-slate-700 truncate">
                      {r.branchName}
                    </p>
                    <p className="text-[10px] text-slate-400">{r.branchCode}</p>
                  </div>
                  <div className="flex-1 h-6 relative">
                    <div
                      className="h-full rounded-r"
                      style={{
                        width: `${Math.max(1, (r.revenue / maxRevenue) * 100)}%`,
                        backgroundColor: "var(--series-1)",
                        borderTopRightRadius: 4,
                        borderBottomRightRadius: 4,
                      }}
                      role="img"
                      aria-label={`${r.branchName}: ${inr(r.revenue)}`}
                    />
                  </div>
                  <span className="w-24 text-right text-xs font-semibold text-slate-700 tabular-nums shrink-0">
                    {inr(r.revenue)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* The table is the accessible view of the same data, and carries the
              measures the chart deliberately leaves out. */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-semibold">Branch</th>
                    <th className="text-right px-4 py-2.5 font-semibold">Revenue</th>
                    <th className="text-right px-4 py-2.5 font-semibold">Invoices</th>
                    <th className="text-right px-4 py-2.5 font-semibold">Avg Bill</th>
                    <th className="text-right px-4 py-2.5 font-semibold">Stock Value</th>
                    <th className="text-right px-4 py-2.5 font-semibold">Units</th>
                    <th className="text-right px-4 py-2.5 font-semibold">Batches</th>
                    <th className="text-right px-4 py-2.5 font-semibold">Expiring 30d</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => (
                    <tr key={r.branchId} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-800">
                            {r.branchName}
                          </span>
                          {!r.isActive && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-medium">
                              Inactive
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-slate-400">{r.branchCode}</span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{inr(r.revenue)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{num(r.invoices)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{inr(r.avgInvoiceValue)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{inr(r.stockValue)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{num(r.units)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{num(r.batches)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {r.expiringSoon > 0 ? (
                          <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                            <AlertTriangle size={11} /> {num(r.expiringSoon)}
                          </span>
                        ) : (
                          <span className="text-slate-400">0</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {totals && (
                  <tfoot className="bg-slate-50 font-semibold text-slate-800 border-t-2 border-slate-200">
                    <tr>
                      <td className="px-4 py-3">All branches</td>
                      <td className="px-4 py-3 text-right tabular-nums">{inr(totals.revenue)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{num(totals.invoices)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{inr(totals.avgInvoiceValue)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{inr(totals.stockValue)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{num(totals.units)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{num(totals.batches)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{num(totals.expiringSoon)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
