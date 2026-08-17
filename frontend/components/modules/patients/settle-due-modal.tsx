"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X, IndianRupee, AlertCircle, Loader2, CheckCircle2 } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";

interface Invoice {
  id: string;
  invoiceNo: string;
  totalAmount: string;
  amountPaid: string;
  amountDue: string;
  status: string;
  createdAt: string;
}

interface Props {
  open: boolean;
  patientId: string;
  patientName: string;
  outstandingBalance: string;
  onClose: () => void;
}

const MODES = ["cash", "upi", "card", "insurance"] as const;

/**
 * Collects a payment against a patient's outstanding partially-paid invoices.
 * The invoice list is server-authoritative; the visible outstanding total is a
 * cache of `patients.outstandingBalance`, which is decremented in the same
 * transaction as the payment insert so the two never drift.
 */
export function SettleDueModal({
  open,
  patientId,
  patientName,
  outstandingBalance,
  onClose,
}: Props) {
  const qc = useQueryClient();
  const { success: toastSuccess, error: toastError } = useToast();
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [amount, setAmount] = useState<string>("");
  const [mode, setMode] = useState<string>("cash");
  const [referenceNo, setReferenceNo] = useState<string>("");

  const { data: raw, isLoading } = useQuery({
    queryKey: ["patient-outstanding-invoices", patientId],
    queryFn: () =>
      apiClient.get("/billing/invoices", {
        params: { patientId, status: "partially_paid", limit: 50 },
      }) as Promise<any>,
    enabled: open && !!patientId,
  });

  const invoices: Invoice[] = useMemo(() => {
    const r = raw as any;
    const arr = r?.data?.data ?? r?.data ?? [];
    return Array.isArray(arr) ? arr : [];
  }, [raw]);

  const selected = invoices.find((i) => i.id === selectedInvoiceId) ?? null;

  const settle = useMutation({
    mutationFn: (body: { invoiceId: string; amount: string; mode: string; referenceNo?: string }) =>
      apiClient.post("/billing/payments", body) as Promise<any>,
    onSuccess: () => {
      toastSuccess("Payment recorded", `₹${amount} collected against ${selected?.invoiceNo}`);
      qc.invalidateQueries({ queryKey: ["patient-outstanding-invoices", patientId] });
      qc.invalidateQueries({ queryKey: ["patients"] });
      setSelectedInvoiceId(null);
      setAmount("");
      setReferenceNo("");
    },
    onError: (err: any) => {
      toastError(
        "Collection failed",
        err?.response?.data?.message ?? "Could not record the payment.",
      );
    },
  });

  if (!open) return null;

  const outstandingNum = Number(outstandingBalance ?? "0");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-900">Collect Due</h2>
            <p className="text-xs text-slate-500 truncate">
              {patientName} · outstanding{" "}
              <span className="font-bold text-purple-700">₹{outstandingNum.toFixed(2)}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {isLoading ? (
            <div className="py-10 text-center">
              <Loader2 size={22} className="mx-auto text-slate-300 animate-spin" />
              <p className="mt-2 text-xs text-slate-400">Loading unpaid invoices…</p>
            </div>
          ) : invoices.length === 0 ? (
            <div className="py-10 text-center">
              <CheckCircle2 size={28} className="mx-auto text-emerald-400" />
              <p className="mt-2 text-sm font-semibold text-slate-700">
                No partially-paid invoices for this patient
              </p>
              <p className="text-xs text-slate-400 mt-1">
                The outstanding balance may reflect a legacy adjustment. Nothing to collect from here.
              </p>
            </div>
          ) : (
            <>
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 mb-2 px-0.5">
                  Unpaid invoices
                </p>
                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {invoices.map((inv) => {
                    const due = Number(inv.amountDue);
                    const isSel = selectedInvoiceId === inv.id;
                    return (
                      <button
                        key={inv.id}
                        type="button"
                        onClick={() => {
                          setSelectedInvoiceId(inv.id);
                          setAmount(due.toFixed(2));
                        }}
                        className={`w-full text-left rounded-xl border px-3 py-2 transition-colors ${
                          isSel
                            ? "border-purple-400 bg-purple-50/60"
                            : "border-slate-200 hover:border-purple-200"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-slate-900 font-mono truncate">
                              {inv.invoiceNo}
                            </p>
                            <p className="text-[11px] text-slate-400">
                              Total ₹{Number(inv.totalAmount).toFixed(2)} · Paid ₹
                              {Number(inv.amountPaid).toFixed(2)}
                            </p>
                          </div>
                          <span className="text-sm font-black text-purple-700 shrink-0">
                            Due ₹{due.toFixed(2)}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {selected && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-3">
                  <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                    Collect against {selected.invoiceNo}
                  </p>

                  <div className="grid grid-cols-4 gap-1.5">
                    {MODES.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMode(m)}
                        className={`py-1.5 rounded-lg text-[11px] font-bold border-2 transition-all ${
                          mode === m
                            ? "border-slate-800 bg-slate-800 text-white"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-400"
                        }`}
                      >
                        {m.toUpperCase()}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <IndianRupee
                        size={14}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                      />
                      <input
                        type="number"
                        min={0.01}
                        max={Number(selected.amountDue)}
                        step="0.01"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="Amount"
                        className="w-full border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-sm font-bold focus:outline-none focus:border-purple-400"
                      />
                    </div>
                    {mode !== "cash" && (
                      <input
                        value={referenceNo}
                        onChange={(e) => setReferenceNo(e.target.value)}
                        placeholder="Ref (opt)"
                        className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-28 focus:outline-none focus:border-purple-400"
                      />
                    )}
                  </div>

                  {parseFloat(amount) > Number(selected.amountDue) + 0.001 && (
                    <div className="flex items-start gap-1.5 text-[11px] text-red-600">
                      <AlertCircle size={11} className="mt-0.5 shrink-0" />
                      Amount exceeds the outstanding due of ₹
                      {Number(selected.amountDue).toFixed(2)}.
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={
                      settle.isPending ||
                      !amount ||
                      parseFloat(amount) <= 0 ||
                      parseFloat(amount) > Number(selected.amountDue) + 0.001
                    }
                    onClick={() =>
                      settle.mutate({
                        invoiceId: selected.id,
                        amount: parseFloat(amount).toFixed(2),
                        mode,
                        referenceNo: mode !== "cash" && referenceNo ? referenceNo : undefined,
                      })
                    }
                    className="w-full bg-purple-600 hover:bg-purple-700 text-white py-2.5 rounded-xl font-bold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {settle.isPending ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 size={14} className="animate-spin" />
                        Recording…
                      </span>
                    ) : (
                      `Collect ₹${(parseFloat(amount) || 0).toFixed(2)}`
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
