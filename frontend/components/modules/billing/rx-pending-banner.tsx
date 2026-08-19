"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FileWarning, ChevronDown, ChevronUp, Paperclip } from "lucide-react";
import { apiClient, queryKeys } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { useActiveBranchId } from "@/hooks/use-branch";
import { RxPickerModal } from "./rx-picker-modal";

/**
 * Schedule H sales a manager vouched for that still owe their prescription.
 *
 * Attesting at the counter is a promise to produce the paper afterwards, and a
 * promise nobody can see is a promise nobody keeps: the sale is complete, the
 * money is banked, and the only trace is a flag on a row. So this sits at the
 * top of the billing screen, does not dismiss itself, and stays until every
 * outstanding bill has a prescription attached. The Schedule H register prints
 * these rows as PRESCRIPTION PENDING in the meantime, which is what an
 * inspector would see.
 */
export function RxPendingBanner() {
  const qc = useQueryClient();
  const { branchId } = useActiveBranchId();
  const { success: toastSuccess, error: toastError } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [target, setTarget] = useState<{ id: string; invoiceNo: string } | null>(null);

  const { data } = useQuery({
    queryKey: ["rx-pending-invoices", branchId],
    queryFn: () =>
      apiClient.get("/billing/invoices", {
        params: { rxPending: true, limit: 50, ...(branchId ? { branchId } : {}) },
      }) as any,
    // Cheap, and it has to be right after a counter sale rather than a minute
    // later — the person who owes the prescription is standing there now.
    staleTime: 15_000,
  });

  const rows: any[] = (() => {
    const raw = data as any;
    if (Array.isArray(raw?.data)) return raw.data;
    if (Array.isArray(raw?.data?.data)) return raw.data.data;
    return [];
  })();

  const attach = useMutation({
    mutationFn: ({ invoiceId, prescriptionId }: { invoiceId: string; prescriptionId: string }) =>
      apiClient.post(`/billing/invoices/${invoiceId}/prescription`, { prescriptionId }) as any,
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: ["rx-pending-invoices"] });
      qc.invalidateQueries({ queryKey: queryKeys.invoices.all() });
      qc.invalidateQueries({ queryKey: queryKeys.invoices.detail(vars.invoiceId) });
      toastSuccess(
        "Prescription attached",
        "That sale is no longer outstanding and the Schedule H register now shows the doctor.",
      );
      setTarget(null);
    },
    onError: (err: any) => {
      toastError(
        "Could not attach the prescription",
        err?.response?.data?.message ?? "Please try again.",
      );
    },
  });

  if (target) {
    return (
      <RxPickerModal
        open
        onClose={() => setTarget(null)}
        onSelectRx={(rxId) => attach.mutate({ invoiceId: target.id, prescriptionId: rxId })}
      />
    );
  }

  if (rows.length === 0) return null;

  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 mb-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <FileWarning size={18} className="text-amber-600 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-amber-900">
              {rows.length} Schedule H {rows.length === 1 ? "sale is" : "sales are"} waiting
              for a prescription
            </p>
            <p className="text-xs text-amber-800 mt-0.5">
              A manager vouched for {rows.length === 1 ? "it" : "them"} at the counter. Until
              the prescription is attached, the Schedule H register shows{" "}
              {rows.length === 1 ? "this sale" : "these sales"} as PRESCRIPTION PENDING.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 flex items-center gap-1 text-xs font-bold text-amber-900 hover:text-amber-950"
        >
          {expanded ? "Hide" : "Show"}
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {expanded && (
        <ul className="mt-3 divide-y divide-amber-200 border-t border-amber-200">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="text-xs font-bold text-amber-900 font-mono truncate">
                  {r.invoiceNo}
                </p>
                <p className="text-[11px] text-amber-700 truncate">
                  {r.patientName ?? "Walk-in"}
                  {r.createdAt
                    ? ` · ${new Date(r.createdAt).toLocaleString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}`
                    : ""}
                  {r.totalAmount ? ` · ₹${Number(r.totalAmount).toFixed(2)}` : ""}
                </p>
              </div>
              <button
                type="button"
                disabled={attach.isPending}
                onClick={() => setTarget({ id: r.id, invoiceNo: r.invoiceNo })}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold transition-colors disabled:opacity-50"
              >
                <Paperclip size={12} /> Attach prescription
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
