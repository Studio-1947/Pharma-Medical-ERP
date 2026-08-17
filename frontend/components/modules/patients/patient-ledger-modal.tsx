"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Modal } from "@/components/ui/modal";
import { ExportButton } from "@/components/shared/export-button";
import { BookOpen, AlertTriangle } from "lucide-react";

interface LedgerEntry {
  date: string;
  type: "invoice" | "credit_note" | "payment" | "refund";
  reference: string;
  debit: string;
  credit: string;
  balance: string;
}

interface PatientLedger {
  patientId: string;
  patientName: string;
  patientPhone: string;
  openingBalance: string;
  entries: LedgerEntry[];
  closingBalance: string;
  storedOutstanding: string;
}

const inr = (v: string | number) => `₹${parseFloat(String(v)).toFixed(2)}`;

const TYPE_STYLES: Record<LedgerEntry["type"], { label: string; className: string }> = {
  invoice: { label: "Invoice", className: "bg-red-50 text-red-600 border-red-100" },
  credit_note: { label: "Credit Note", className: "bg-blue-50 text-blue-700 border-blue-100" },
  payment: { label: "Payment", className: "bg-emerald-50 text-emerald-700 border-emerald-100" },
  refund: { label: "Refund", className: "bg-amber-50 text-amber-700 border-amber-100" },
};

/**
 * Customer account statement — the receivables mirror of the supplier ledger.
 * Same debit/credit/running-balance shape so a counter that reads one can read
 * the other without relearning the columns.
 */
export function PatientLedgerModal({
  patientId,
  patientName,
  open,
  onClose,
  onCollect,
}: {
  patientId: string;
  patientName: string;
  open: boolean;
  onClose: () => void;
  /** Optional hand-off to the collection flow, when the caller has one. */
  onCollect?: () => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["patient-ledger", patientId, from, to],
    queryFn: () =>
      apiClient.get(`/billing/patients/${patientId}/ledger`, {
        params: { from: from || undefined, to: to || undefined },
      }) as Promise<any>,
    enabled: open && !!patientId,
  });

  const ledger = (data as any)?.data as PatientLedger | undefined;

  // The stored column is what the POS reads; the closing balance is recomputed
  // from the rows below. They should agree — surfacing a mismatch is the point,
  // because a silent divergence is the failure that would otherwise go unseen.
  const drifted =
    !!ledger &&
    Math.abs(parseFloat(ledger.closingBalance) - parseFloat(ledger.storedOutstanding)) > 0.005;

  return (
    <Modal
      title={`${patientName} — Ledger`}
      subtitle={ledger?.patientPhone ? `Account statement · ${ledger.patientPhone}` : "Account statement"}
      open={open}
      onClose={onClose}
      size="2xl"
      icon={<BookOpen className="w-4 h-4" />}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 border rounded-xl px-4 py-3">
          <div>
            <p className="text-xs font-semibold text-slate-400">Outstanding</p>
            <p
              className={`text-xl font-bold ${
                parseFloat(ledger?.storedOutstanding ?? "0") > 0 ? "text-purple-700" : "text-slate-700"
              }`}
            >
              {inr(ledger?.storedOutstanding ?? "0")}
            </p>
          </div>
          {onCollect && parseFloat(ledger?.storedOutstanding ?? "0") > 0 && (
            <button
              onClick={onCollect}
              className="ml-auto inline-flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-purple-700 transition-colors shadow-sm"
            >
              Collect Payment
            </button>
          )}
        </div>

        {drifted && (
          <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
            <span>
              The stored balance ({inr(ledger!.storedOutstanding)}) does not match the statement total (
              {inr(ledger!.closingBalance)}). Worth reconciling before collecting.
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold">From</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="border rounded-lg px-3 py-1.5 text-sm bg-background"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold">To</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="border rounded-lg px-3 py-1.5 text-sm bg-background"
            />
          </div>
          <ExportButton
            url={`/billing/patients/${patientId}/ledger`}
            params={{ from: from || undefined, to: to || undefined }}
            filename={`patient-ledger-${patientName.replace(/\s+/g, "-").toLowerCase()}.csv`}
            className="ml-auto flex items-center gap-2 px-3 py-1.5 border rounded-lg text-xs font-semibold hover:bg-muted transition-colors"
          />
        </div>

        {isLoading ? (
          <div className="animate-pulse h-40 bg-muted rounded-xl" />
        ) : !ledger || ledger.entries.length === 0 ? (
          <div className="text-center py-10 text-sm text-muted-foreground">
            No billing activity in this period.
          </div>
        ) : (
          <div className="border rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                <tr>
                  <th className="text-left px-3 py-2">Date</th>
                  <th className="text-left px-3 py-2">Type</th>
                  <th className="text-left px-3 py-2">Reference</th>
                  <th className="text-right px-3 py-2">Debit</th>
                  <th className="text-right px-3 py-2">Credit</th>
                  <th className="text-right px-3 py-2">Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t text-slate-400 italic">
                  <td className="px-3 py-2" colSpan={5}>
                    Opening balance
                  </td>
                  <td className="px-3 py-2 text-right">{inr(ledger.openingBalance)}</td>
                </tr>
                {ledger.entries.map((e, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-2 whitespace-nowrap">{e.date.slice(0, 10)}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${TYPE_STYLES[e.type].className}`}
                      >
                        {TYPE_STYLES[e.type].label}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{e.reference}</td>
                    <td className="px-3 py-2 text-right">
                      {parseFloat(e.debit) !== 0 ? inr(e.debit) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {parseFloat(e.credit) !== 0 ? inr(e.credit) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">{inr(e.balance)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 bg-slate-50 font-bold text-slate-800">
                  <td className="px-3 py-2.5" colSpan={5}>
                    Closing balance
                  </td>
                  <td className="px-3 py-2.5 text-right">{inr(ledger.closingBalance)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
