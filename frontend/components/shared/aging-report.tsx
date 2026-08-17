"use client";

import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

/**
 * The presentation half of both money-aging screens.
 *
 * Payables and receivables come back from the API on the same bucket ladder,
 * so they render through one component: the two screens sit next to each other
 * on a cash review and columns that drifted apart would have to be mentally
 * translated every time. Each screen supplies only what differs — the row
 * shape, the two identity columns, and what a click does.
 */

export interface AgingBucket {
  key: string;
  label: string;
  amount: string;
}

export interface AgingRow {
  current: string;
  d1_30: string;
  d31_60: string;
  d61_90: string;
  d90plus: string;
  overdue: string;
  total: string;
}

export interface AgingTotals extends AgingRow {
  [key: string]: unknown;
}

export const inr = (v: string | number | null | undefined) =>
  `₹${parseFloat(String(v ?? "0")).toFixed(2)}`;

/** Blank rather than ₹0.00 — a ladder of zeros buries the columns that matter. */
const cell = (v: string) => (parseFloat(v) > 0 ? inr(v) : "—");

/**
 * Older money is redder. The ramp is the whole point of the screen: a glance
 * should land on the 90+ column before anything else.
 */
const BUCKET_TONE: Record<string, string> = {
  current: "text-slate-600",
  d1_30: "text-amber-600",
  d31_60: "text-orange-600",
  d61_90: "text-red-600",
  d90plus: "text-red-700 font-bold",
};

const BUCKET_CARD_TONE: Record<string, string> = {
  current: "bg-slate-50 border-slate-200 text-slate-700",
  d1_30: "bg-amber-50 border-amber-200 text-amber-700",
  d31_60: "bg-orange-50 border-orange-200 text-orange-700",
  d61_90: "bg-red-50 border-red-200 text-red-600",
  d90plus: "bg-red-100 border-red-300 text-red-800",
};

export function AgingBucketCards({
  buckets,
  totals,
  overdueLabel,
}: {
  buckets: AgingBucket[];
  totals: AgingTotals;
  overdueLabel: string;
}) {
  const overdue = parseFloat(totals.overdue);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {buckets.map((b) => (
          <div
            key={b.key}
            className={`rounded-xl border px-4 py-3 ${BUCKET_CARD_TONE[b.key] ?? "bg-slate-50 border-slate-200"}`}
          >
            <p className="text-[11px] font-bold uppercase tracking-wide opacity-70">{b.label}</p>
            <p className="text-lg font-extrabold mt-0.5">{inr(b.amount)}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-xl border bg-white px-4 py-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Total outstanding</p>
          <p className="text-xl font-extrabold text-slate-800">{inr(totals.total)}</p>
        </div>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{overdueLabel}</p>
          <p className={`text-xl font-extrabold ${overdue > 0 ? "text-red-600" : "text-slate-700"}`}>
            {inr(totals.overdue)}
          </p>
        </div>
        {overdue > 0 && (
          <div className="ml-auto flex items-center gap-2 text-xs font-semibold text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Past due and needs chasing
          </div>
        )}
      </div>
    </div>
  );
}

export function AgingTable<T extends AgingRow>({
  rows,
  buckets,
  columns,
  totals,
  onRowClick,
  rowKey,
  emptyMessage,
  actionLabel,
}: {
  rows: T[];
  buckets: AgingBucket[];
  /** The one or two identity columns that differ per report. */
  columns: { header: string; render: (row: T) => ReactNode }[];
  totals: AgingTotals;
  onRowClick?: (row: T) => void;
  rowKey: (row: T) => string;
  emptyMessage: string;
  /** A function form lets a row that cannot be drilled into show no action,
   *  rather than offering a link that does nothing when clicked. */
  actionLabel?: string | ((row: T) => string | null);
}) {
  const labelFor = (row: T) => (typeof actionLabel === "function" ? actionLabel(row) : actionLabel);
  const hasActionColumn = !!onRowClick && !!actionLabel;
  if (rows.length === 0) {
    return (
      <div className="text-center py-14 border rounded-xl bg-white">
        <p className="text-sm font-semibold text-slate-500">{emptyMessage}</p>
        <p className="text-xs text-slate-400 mt-1">Nothing is outstanding right now.</p>
      </div>
    );
  }

  return (
    <div className="border rounded-xl overflow-x-auto bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-[11px] text-slate-500 uppercase tracking-wide">
          <tr>
            {columns.map((c) => (
              <th key={c.header} className="text-left px-4 py-2.5 font-bold whitespace-nowrap">
                {c.header}
              </th>
            ))}
            {buckets.map((b) => (
              <th key={b.key} className="text-right px-3 py-2.5 font-bold whitespace-nowrap">
                {b.label}
              </th>
            ))}
            <th className="text-right px-4 py-2.5 font-bold">Total</th>
            {hasActionColumn && <th className="px-3 py-2.5" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`border-t ${onRowClick && labelFor(row) ? "cursor-pointer hover:bg-slate-50 transition-colors" : ""}`}
            >
              {columns.map((c) => (
                <td key={c.header} className="px-4 py-2.5">
                  {c.render(row)}
                </td>
              ))}
              <td className={`px-3 py-2.5 text-right ${BUCKET_TONE.current}`}>{cell(row.current)}</td>
              <td className={`px-3 py-2.5 text-right ${BUCKET_TONE.d1_30}`}>{cell(row.d1_30)}</td>
              <td className={`px-3 py-2.5 text-right ${BUCKET_TONE.d31_60}`}>{cell(row.d31_60)}</td>
              <td className={`px-3 py-2.5 text-right ${BUCKET_TONE.d61_90}`}>{cell(row.d61_90)}</td>
              <td className={`px-3 py-2.5 text-right ${BUCKET_TONE.d90plus}`}>{cell(row.d90plus)}</td>
              <td className="px-4 py-2.5 text-right font-bold text-slate-800">{inr(row.total)}</td>
              {hasActionColumn && (
                <td className="px-3 py-2.5 text-right">
                  {labelFor(row) && (
                    <span className="text-xs font-semibold text-emerald-700 hover:underline whitespace-nowrap">
                      {labelFor(row)}
                    </span>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 bg-slate-50 font-bold text-slate-800">
            <td className="px-4 py-3" colSpan={columns.length}>
              Total
            </td>
            <td className="px-3 py-3 text-right">{cell(totals.current)}</td>
            <td className="px-3 py-3 text-right">{cell(totals.d1_30)}</td>
            <td className="px-3 py-3 text-right">{cell(totals.d31_60)}</td>
            <td className="px-3 py-3 text-right">{cell(totals.d61_90)}</td>
            <td className="px-3 py-3 text-right">{cell(totals.d90plus)}</td>
            <td className="px-4 py-3 text-right">{inr(totals.total)}</td>
            {hasActionColumn && <td />}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
