"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Modal } from "@/components/ui/modal";
import { format } from "date-fns";
import { Receipt, AlertTriangle, Loader2 } from "lucide-react";

/**
 * Read-only view of a past invoice: what was dispensed, from which batch, and
 * how it was paid.
 *
 * Batch and expiry are shown deliberately — when a patient returns with a
 * reaction or a recall lands, the question is which physical pack they were
 * given, and that is recorded on the invoice line rather than the prescription.
 */

function inr(v: unknown) {
  const n = Number(v ?? 0);
  return `₹${n.toFixed(2)}`;
}

function fmtDate(value?: string | null) {
  if (!value) return "--";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "--" : format(d, "MMM d, yyyy · h:mm a");
}

export function InvoiceDetailModal({
  invoiceId,
  onClose,
}: {
  invoiceId: string;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["invoice-detail", invoiceId],
    queryFn: () => apiClient.get(`/billing/invoices/${invoiceId}`) as Promise<any>,
    enabled: !!invoiceId,
  });

  const raw = data as any;
  const inv = raw?.data?.data ?? raw?.data ?? raw;
  const items: any[] = Array.isArray(inv?.items) ? inv.items : [];
  const payments: any[] = Array.isArray(inv?.payments) ? inv.payments : [];

  return (
    <Modal
      title={inv?.invoiceNo ? `Invoice ${inv.invoiceNo}` : "Invoice"}
      subtitle={inv?.createdAt ? fmtDate(inv.createdAt) : undefined}
      icon={<Receipt size={16} />}
      open
      onClose={onClose}
      size="xl"
    >
      {isLoading ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="animate-spin" size={22} />
          <p className="text-sm">Loading invoice...</p>
        </div>
      ) : isError || !inv ? (
        <div className="flex items-start gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <p>Could not load this invoice.</p>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <p className="text-[11px] text-muted-foreground">Patient</p>
              <p className="font-medium truncate">{inv.patient?.name ?? "Walk-in"}</p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">Status</p>
              <p className="font-medium capitalize">{(inv.status ?? "").replace(/_/g, " ")}</p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">Total</p>
              <p className="font-semibold tabular-nums">{inr(inv.totalAmount)}</p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">Due</p>
              <p className="font-medium tabular-nums">{inr(inv.amountDue)}</p>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-2">Items Dispensed</h3>
            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground">No line items on this invoice.</p>
            ) : (
              <div className="rounded-lg border overflow-hidden overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-muted-foreground text-xs">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Medicine</th>
                      <th className="text-left px-3 py-2 font-medium">Batch</th>
                      <th className="text-right px-3 py-2 font-medium">Qty</th>
                      <th className="text-right px-3 py-2 font-medium">Rate</th>
                      <th className="text-right px-3 py-2 font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {items.map((it, i) => (
                      <tr key={it.id ?? i}>
                        <td className="px-3 py-2 font-medium">
                          {it.itemName ?? it.medicine?.name ?? it.medicineName ?? "--"}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground text-xs">
                          {it.batch?.batchNo ?? (it.itemType === "consultation" ? "Service" : "--")}
                          {it.batch?.expiryDate && (
                            <span className="block text-[10px]">
                              exp {fmtDate(it.batch.expiryDate).split(" · ")[0]}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{it.quantity ?? 0}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{inr(it.unitPrice)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{inr(it.lineTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {payments.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2">Payments</h3>
              <div className="space-y-1.5">
                {payments.map((p, i) => (
                  <div
                    key={p.id ?? i}
                    className="flex items-center justify-between border rounded-lg px-3 py-2 text-sm"
                  >
                    <span className="capitalize font-medium">{p.mode ?? "--"}</span>
                    <span className="tabular-nums">{inr(p.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
