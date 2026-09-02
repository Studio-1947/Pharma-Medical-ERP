"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Modal } from "@/components/ui/modal";
import { format } from "date-fns";
import { Receipt, AlertTriangle, Loader2, Printer } from "lucide-react";
import { formatTokenNo } from "@pharmerp/types";
import { ShareRecordButton } from "@/components/shared/share-record-button";
import { buildReceiptHeaderHtml, RECEIPT_HEADER_STYLES } from "@/lib/receipt-header";

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

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>\"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
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
  const printInvoice = () => {
    if (!inv) return;
    const popup = window.open("", "_blank", "width=794,height=1050");
    if (!popup) return;
    const rows = items.map((item, index) => `
      <tr>
        <td><div class="medicine-name">${index + 1}. ${escapeHtml(item.itemName ?? item.medicine?.name ?? item.medicineName ?? "--")}</div><div class="batch-label">Batch: ${escapeHtml(item.batch?.batchNo ?? item.batchNo ?? "--")}</div></td>
        <td class="center">${escapeHtml(item.quantity ?? 0)}</td>
        <td class="right">${inr(item.unitPrice)}</td>
        <td class="right">${Number(item.discountPct ?? 0) > 0 ? `${escapeHtml(item.discountPct)}%` : "--"}</td>
        <td class="right">${Number(item.taxPct ?? 0) > 0 ? `${escapeHtml(item.taxPct)}%` : "--"}</td>
        <td class="right amount">${inr(item.lineTotal)}</td>
      </tr>`).join("");
    const paymentRows = payments.map((payment) =>
      `<tr><td>${escapeHtml(payment.mode ?? "--")}</td><td class="right">${inr(payment.amount)}</td></tr>`,
    ).join("");
    popup.document.write(`<!doctype html><html><head><title>Invoice ${escapeHtml(inv.invoiceNo)}</title>
      <style>
        @page{size:A4;margin:18mm 20mm}*{box-sizing:border-box}body{font:14px 'Segoe UI',Arial,sans-serif;color:#111}.divider{border:0;border-top:1px dashed #bbb;margin:14px 0}.divider-solid{border:0;border-top:2px solid #333;margin:14px 0}.meta{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px}.label{color:#666;font-size:11px;text-transform:uppercase;letter-spacing:.5px}.value{font-size:14px;font-weight:700;margin-top:2px}.right{text-align:right}.center{text-align:center}table{width:100%;border-collapse:collapse}th{font-size:11px;text-transform:uppercase;color:#555;letter-spacing:.5px;padding:7px 6px;border-bottom:2px solid #ddd;text-align:left}td{padding:9px 6px;border-bottom:1px dashed #e5e5e5;vertical-align:top;font-size:13px}.medicine-name{font-size:14px;font-weight:600}.batch-label{color:#777;font-size:11px;margin-top:2px}.amount{font-weight:700}.totals td{padding:5px 6px;border:0}.grand td{font-size:18px;font-weight:900;padding-top:10px;border-top:1px dashed #bbb}.section-label{font-size:11px;font-weight:700;text-transform:uppercase;color:#555;letter-spacing:.7px;margin:12px 0 6px}.badge{display:inline-block;border:1px solid #ddd;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:600;text-transform:capitalize}.footer{text-align:center;color:#666;font-size:11px;margin-top:20px;padding-top:12px;border-top:1px dashed #ddd;line-height:1.7}${RECEIPT_HEADER_STYLES}
      </style></head><body>
      ${buildReceiptHeaderHtml({ tokenNo: inv.tokenNo, origin: window.location.origin, subtitle: "Tax Invoice / Bill of Supply" })}<hr class="divider-solid"/>
      <div class="meta"><div><div class="label">Invoice No</div><div class="value" style="font-family:monospace">${escapeHtml(inv.invoiceNo ?? "--")}</div></div><div class="right"><div class="label">Date &amp; Time</div><div class="value">${escapeHtml(fmtDate(inv.createdAt))}</div></div><div style="grid-column:span 2"><div class="label">Patient</div><div class="value">${escapeHtml(inv.patient?.name ?? "Walk-in Customer")}</div></div></div>
      <hr class="divider"/><table><thead><tr><th style="width:45%">Medicine</th><th class="center">Qty</th><th class="right">MRP/Unit</th><th class="right">Disc</th><th class="right">Tax</th><th class="right">Amount</th></tr></thead><tbody>${rows}</tbody></table>
      <hr class="divider"/><table class="totals"><tbody><tr><td>Subtotal</td><td class="right">${inr(inv.subtotal)}</td></tr><tr><td>Tax (GST)</td><td class="right">${inr(inv.taxAmount)}</td></tr>${Number(inv.discountAmount ?? 0) > 0 ? `<tr><td>Discount</td><td class="right">-${inr(inv.discountAmount)}</td></tr>` : ""}<tr class="grand"><td>TOTAL AMOUNT</td><td class="right">${inr(inv.totalAmount)}</td></tr></tbody></table>
      <hr class="divider"/>${paymentRows ? `<div class="section-label">Payment Details</div><table class="totals"><tbody>${paymentRows}</tbody></table>` : ""}<div class="footer"><b>Thank you for choosing Radha Madhav Medical Hall</b><br/>Goods once sold will not be taken back without a valid reason.<br/>For queries, please contact your shop manager.</div></body></html>`);
    popup.document.close();
    popup.focus();
    const print = () => { popup.print(); popup.close(); };
    const logo = popup.document.getElementById("brand-logo") as HTMLImageElement | null;
    if (logo && !logo.complete) {
      logo.addEventListener("load", print, { once: true });
      logo.addEventListener("error", print, { once: true });
      setTimeout(print, 2000);
    } else {
      setTimeout(print, 300);
    }
  };

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
          {/* Clinic queue token, above the invoice details so it reads the same
              way as the printed copy. Absent for walk-in sales. */}
          {formatTokenNo(inv.tokenNo) && (
            <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Token No.
              </span>
              <span className="text-lg font-black tracking-widest tabular-nums text-slate-900">
                {formatTokenNo(inv.tokenNo)}
              </span>
            </div>
          )}

          {/* Patient-facing link. Revocable and expiring, so a bill sent to the
              wrong number can be killed. */}
          <div className="flex flex-wrap items-center gap-2">
            <ShareRecordButton type="invoice" recordId={inv.id} label="Share bill with patient" />
            <button
              type="button"
              onClick={printInvoice}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              <Printer size={14} /> Print bill
            </button>
          </div>

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
            {/* Counter sales carry no prescription, so this is the only place
                the doctor behind one is recorded. */}
            {inv.referredByDoctor && (
              <div>
                <p className="text-[11px] text-muted-foreground">Doctor</p>
                <p className="font-medium truncate">
                  {[inv.referredByDoctor.firstName, inv.referredByDoctor.lastName]
                    .filter(Boolean)
                    .join(" ") || "Doctor"}
                </p>
              </div>
            )}
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
