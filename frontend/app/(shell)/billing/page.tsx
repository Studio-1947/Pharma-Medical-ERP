"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiClient, queryKeys } from "@/lib/api-client";
import { useNavigation } from "@/lib/navigation-context";
import { useAuthStore } from "@/stores/auth.store";
import { ShoppingCart, XCircle, RotateCcw, AlertCircle, Download, Search, BarChart2, Receipt, ListOrdered } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { PatientFirstBilling } from "@/components/modules/billing/patient-first-billing";
import { PosTerminal } from "@/components/modules/billing/pos-terminal";
import { StuckSalesBanner } from "@/components/modules/billing/stuck-sales-banner";
import { RxPendingBanner } from "@/components/modules/billing/rx-pending-banner";
import { errorText } from "@/lib/error-message";

// ─── PDF download button (polls until ready) ─────────────────────────────────

function PdfButton({ invoiceId }: { invoiceId: string }) {
  const [state, setState] = useState<"idle" | "polling" | "done" | "error">("idle");

  const handleDownload = async () => {
    setState("polling");
    let attempts = 0;
    const maxAttempts = 12; // 12 × 2.5s = 30s max

    const tryFetch = async (): Promise<void> => {
      try {
        const res: any = await apiClient.get(`/billing/invoices/${invoiceId}/pdf`);
        if (res.ready && res.url) {
          setState("done");
          window.open(res.url, "_blank");
          setTimeout(() => setState("idle"), 3000);
          return;
        }
      } catch {
        // server error — stop polling
        setState("error");
        return;
      }
      attempts++;
      if (attempts >= maxAttempts) {
        setState("error");
        return;
      }
      await new Promise((r) => setTimeout(r, 2500));
      return tryFetch();
    };

    await tryFetch();
  };

  if (state === "polling") {
    return (
      <span className="flex items-center gap-1 text-xs text-slate-400">
        <span className="w-3 h-3 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
        Generating…
      </span>
    );
  }
  if (state === "done") {
    return <span className="text-xs text-green-600 font-medium">Opened</span>;
  }
  if (state === "error") {
    return (
      <button onClick={() => setState("idle")} className="text-xs text-red-500 hover:underline">
        Retry PDF
      </button>
    );
  }

  return (
    <button
      onClick={handleDownload}
      className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 hover:underline"
      title="Download PDF"
    >
      <Download size={12} />
      PDF
    </button>
  );
}

// ─── Void modal ───────────────────────────────────────────────────────────────

function VoidModal({
  invoice,
  open,
  onClose,
}: {
  invoice: any | null;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiClient.post(`/billing/invoices/${id}/void`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.invoices.all() });
      setReason("");
      onClose();
    },
    onError: (err: any) =>
      setError(errorText(err)),
  });

  if (!invoice) return null;

  const handleSubmit = () => {
    if (!reason.trim()) { setError("A reason is required to void the invoice."); return; }
    setError(null);
    mutation.mutate({ id: invoice.id, reason: reason.trim() });
  };

  return (
    <Modal
      title="Void Invoice"
      subtitle={`Invoice ${invoice.invoiceNo} — this action cannot be undone`}
      icon={<XCircle size={16} />}
      open={open}
      onClose={onClose}
      size="sm"
    >
      <div className="px-6 py-5 space-y-4">
        <p className="text-sm text-muted-foreground">
          Voiding will reverse all stock deductions from this invoice. Enter a reason to proceed.
        </p>
        <div className="space-y-1">
          <label className="text-sm font-medium">Reason <span className="text-red-500">*</span></label>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Data entry error, duplicate invoice..."
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
          />
        </div>
        {error && (
          <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertCircle size={14} /> {error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 border rounded-lg text-sm font-medium hover:bg-muted transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={mutation.isPending}
            className="flex items-center gap-2 px-5 py-2 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {mutation.isPending ? (
              <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Voiding...</>
            ) : (
              <><XCircle size={14} /> Void Invoice</>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Return modal ─────────────────────────────────────────────────────────────

function ReturnModal({
  invoice,
  open,
  onClose,
}: {
  invoice: any | null;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [returnQtys, setReturnQtys] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  // A return against an unpaid credit sale moves no cash — it cancels what the
  // patient still owes. Closing straight to the list would leave the operator
  // guessing how much to take out of the till, so the outcome is shown and
  // has to be acknowledged.
  const [result, setResult] = useState<{ cashRefund: string; creditAgainstDue: string } | null>(null);

  const { data: detailRaw, isLoading: loadingDetail } = useQuery({
    queryKey: ["invoice-detail", invoice?.id],
    queryFn: () => apiClient.get(`/billing/invoices/${invoice!.id}`),
    enabled: open && !!invoice?.id,
  });

  const items: any[] = (detailRaw as any)?.items ?? (detailRaw as any)?.data?.items ?? [];

  const mutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) =>
      apiClient.post(`/billing/invoices/${id}/return`, body) as Promise<{
        data: { cashRefund?: string; creditAgainstDue?: string };
      }>,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: queryKeys.invoices.all() });
      setReason("");
      setReturnQtys({});
      setResult({
        cashRefund: res?.data?.cashRefund ?? "0.00",
        creditAgainstDue: res?.data?.creditAgainstDue ?? "0.00",
      });
    },
    onError: (err: any) =>
      setError(errorText(err)),
  });

  if (!invoice) return null;

  const handleSubmit = () => {
    if (!reason.trim()) { setError("A reason is required for the return."); return; }
    const returnItems = items
      .map((item: any) => ({ invoiceItemId: item.id, returnQty: returnQtys[item.id] ?? 0 }))
      .filter((i) => i.returnQty > 0);
    if (returnItems.length === 0) { setError("Select at least one item with a return quantity > 0."); return; }
    setError(null);
    mutation.mutate({ id: invoice.id, body: { items: returnItems, reason: reason.trim() } });
  };

  return (
    <Modal
      title="Return Invoice"
      subtitle={`Invoice ${invoice.invoiceNo} — enter quantities to return`}
      icon={<RotateCcw size={16} />}
      open={open}
      onClose={onClose}
      size="lg"
    >
      <div className="px-6 py-5 space-y-4">
        {result ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
              <p className="text-sm font-semibold text-emerald-800">Return recorded</p>
              <p className="text-xs text-emerald-700 mt-0.5">Stock has been added back to the batch.</p>
            </div>

            <dl className="rounded-lg border divide-y text-sm">
              <div className="flex items-center justify-between px-4 py-2.5">
                <dt className="text-muted-foreground">Cash to refund</dt>
                <dd className="font-semibold tabular-nums">₹{result.cashRefund}</dd>
              </div>
              {Number(result.creditAgainstDue) > 0 && (
                <div className="flex items-center justify-between px-4 py-2.5">
                  <dt className="text-muted-foreground">Cancelled from outstanding</dt>
                  <dd className="font-semibold tabular-nums">₹{result.creditAgainstDue}</dd>
                </div>
              )}
            </dl>

            {Number(result.cashRefund) === 0 && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                This invoice was unpaid, so the return reduced what the patient owes.
                Do not take anything out of the till.
              </p>
            )}

            <div className="flex justify-end pt-1">
              <button
                onClick={() => { setResult(null); onClose(); }}
                className="px-5 py-2 bg-slate-800 text-white text-sm font-semibold rounded-lg hover:bg-slate-900 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        ) : loadingDetail ? (
          <div className="text-center py-8 text-muted-foreground text-sm">Loading invoice details...</div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Medicine</th>
                    <th className="text-right px-4 py-2 font-medium">Sold Qty</th>
                    <th className="text-right px-4 py-2 font-medium w-32">Return Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((item: any) => (
                    <tr key={item.id} className="hover:bg-muted/30">
                      <td className="px-4 py-2 font-medium text-slate-800">
                        {item.medicineName ?? item.medicine?.name ?? item.medicineId}
                      </td>
                      <td className="px-4 py-2 text-right text-muted-foreground">{item.quantity}</td>
                      <td className="px-4 py-2 text-right">
                        <input
                          type="number"
                          min={0}
                          max={item.quantity}
                          value={returnQtys[item.id] ?? 0}
                          onChange={(e) =>
                            setReturnQtys((prev) => ({
                              ...prev,
                              [item.id]: Math.min(item.quantity, Math.max(0, Number(e.target.value))),
                            }))
                          }
                          className="w-24 border rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={3} className="text-center py-8 text-muted-foreground text-xs">
                        No line items found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Return Reason <span className="text-red-500">*</span></label>
              <textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Wrong medicine dispensed, patient requested return..."
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <AlertCircle size={14} /> {error}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose} className="px-4 py-2 border rounded-lg text-sm font-medium hover:bg-muted transition-colors">
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={mutation.isPending}
                className="flex items-center gap-2 px-5 py-2 bg-amber-600 text-white text-sm font-semibold rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
              >
                {mutation.isPending ? (
                  <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Processing...</>
                ) : (
                  <><RotateCcw size={14} /> Create Return</>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ─── End-of-Day Summary ───────────────────────────────────────────────────────

function EodSummary() {
  const today = new Date().toISOString().split("T")[0]!;
  const [date, setDate] = useState(today);
  const [open, setOpen] = useState(false);

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["eod-summary", date],
    queryFn: () => apiClient.get("/billing/reports/end-of-day", { params: { date } }) as any,
    enabled: open,
  });

  const summary = (data as any)?.data ?? data;

  return (
    <div className="mt-6 border rounded-xl overflow-hidden">
      <button
        onClick={() => { setOpen((o) => !o); if (!open) refetch(); }}
        className="w-full flex items-center justify-between px-5 py-3.5 bg-muted/30 hover:bg-muted/50 transition-colors text-sm font-semibold"
      >
        <div className="flex items-center gap-2">
          <BarChart2 size={16} />
          End-of-Day Summary
        </div>
        <span className="text-muted-foreground text-xs">{open ? "Collapse" : "Expand"}</span>
      </button>

      {open && (
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium">Date</label>
            <input
              type="date"
              value={date}
              max={today}
              onChange={(e) => setDate(e.target.value)}
              className="border rounded-lg px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          {isFetching && <div className="text-sm text-muted-foreground animate-pulse">Loading summary…</div>}
          {summary && !isFetching && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: "Total Invoices", value: summary.totalInvoices, prefix: "", suffix: "" },
                { label: "Total Sales", value: Number(summary.totalSales).toFixed(2), prefix: "₹", suffix: "" },
                { label: "Total GST", value: Number(summary.totalTax).toFixed(2), prefix: "₹", suffix: "" },
                { label: "Discounts Given", value: Number(summary.totalDiscounts).toFixed(2), prefix: "₹", suffix: "" },
              ].map(({ label, value, prefix }) => (
                <div key={label} className="bg-muted/20 border rounded-xl p-4 text-center">
                  <p className="text-xs text-muted-foreground mb-1">{label}</p>
                  <p className="text-xl font-bold text-slate-900">{prefix}{value}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function BillingPage() {
  const { navigate } = useNavigation();
  const { user } = useAuthStore();
  const [page, setPage] = useState(1);
  const [showHistory, setShowHistory] = useState(false);
  // In the new flow the payment POS renders inline on this page — the classic
  // POS route is never navigated to, so no classic POS screen is ever shown.
  const [paying, setPaying] = useState(false);
  const [voidTarget, setVoidTarget] = useState<any | null>(null);
  const [returnTarget, setReturnTarget] = useState<any | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // The super-admin billing flow switch decides what the counter desk lands
  // on. "new" = patient-first screen; "old" (default) = the invoice list with
  // the classic POS button. The legacy flow is never removed — the new screen
  // carries a link to it, and the invoice list below stays reachable via the
  // "Invoice History" toggle.
  const { data: settingsRaw } = useQuery({
    queryKey: ["billing-flow"],
    queryFn: () => apiClient.get("/settings") as any,
    retry: 1,
  });
  const billingFlow: "old" | "new" =
    (settingsRaw as any)?.data?.billingFlow === "old" ? "old" : "new";
  const newFlowActive = billingFlow === "new";

  const filters = {
    page,
    limit: 20,
    ...(search ? { search } : {}),
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(dateFrom ? { from: dateFrom } : {}),
    ...(dateTo ? { to: dateTo } : {}),
  };

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.invoices.list(filters),
    queryFn: () => apiClient.get("/billing/invoices", { params: filters }) as any,
    // Skip fetching the invoice list while the counter desk is showing; the
    // hooks still run so order is stable across the flow switch.
    enabled: !(newFlowActive && !showHistory),
  });

  const invoices: any[] = (data as any)?.data ?? [];
  const meta = (data as any)?.meta;

  function handleFilterChange() {
    setPage(1);
  }

  const statusColor: Record<string, string> = {
    confirmed: "bg-emerald-100 text-emerald-700",
    paid: "bg-green-100 text-green-700",
    partially_paid: "bg-amber-100 text-amber-700",
    cancelled: "bg-red-100 text-red-700",
    void: "bg-red-100 text-red-700",
    draft: "bg-gray-100 text-gray-600",
  };

  if (newFlowActive && !showHistory) {
    // Payment happens inline: the desk builds the bill, then this page swaps
    // to the embedded POS terminal for checkout. The classic POS route is
    // never visited, so a shop manager never sees a classic POS screen.
    if (paying) {
      return (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setPaying(false)}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-slate-600 text-xs font-semibold hover:bg-slate-50 hover:text-slate-900 transition-all"
              title="Back to the counter desk — the bill is kept"
            >
              <ShoppingCart size={14} />
              Back to Counter Desk
            </button>
          </div>
          <PosTerminal paymentOnly />
        </div>
      );
    }
    return (
      <div>
        <div className="mb-4 flex items-center justify-end">
          <button
            onClick={() => setShowHistory(true)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-slate-600 text-xs font-semibold hover:bg-slate-50 hover:text-slate-900 transition-all"
          >
            <ListOrdered size={14} />
            Invoice History
          </button>
        </div>
        <PatientFirstBilling onContinueToPayment={() => setPaying(true)} />
      </div>
    );
  }

  return (
    <div>
      {/* Shown on both billing entry points: whichever screen the counter is
          on, an unrecorded sale is the most urgent thing there is. */}
      <StuckSalesBanner />
      <RxPendingBanner />
      {newFlowActive && (
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Receipt size={14} className="text-emerald-600" />
            New billing flow is active — this is the invoice history for the
            patient-first counter desk.
          </div>
          <button
            onClick={() => setShowHistory(false)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-slate-600 text-xs font-semibold hover:bg-slate-50 hover:text-slate-900 transition-all"
          >
            <ShoppingCart size={14} />
            Back to Counter Desk
          </button>
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-semibold">Billing</h2>
        {/* Open POS is available to everyone in the old (legacy) flow — the
            classic terminal is its primary interface. In the new flow it stays
            reachable only for super admins, who use it as the fallback; shop
            managers are sent back to the counter desk by /billing/pos anyway. */}
        {(user?.role === "super_admin" || !newFlowActive) && (
          <button
            onClick={() => navigate("/billing/pos")}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-lg text-sm font-medium hover:from-emerald-700 hover:to-teal-700 transition-all"
          >
            <ShoppingCart size={16} /> Open POS
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5 p-4 bg-muted/30 rounded-xl border">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); handleFilterChange(); }}
            placeholder="Search invoice no..."
            className="w-full border rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 bg-background"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); handleFilterChange(); }}
          className="border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="confirmed">Confirmed</option>
          <option value="paid">Paid</option>
          <option value="partially_paid">Partially Paid</option>
          <option value="void">Void</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => { setDateFrom(e.target.value); handleFilterChange(); }}
          className="border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
          title="From date"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => { setDateTo(e.target.value); handleFilterChange(); }}
          className="border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
          title="To date"
        />
        {(search || statusFilter || dateFrom || dateTo) && (
          <button
            onClick={() => { setSearch(""); setStatusFilter(""); setDateFrom(""); setDateTo(""); setPage(1); }}
            className="px-3 py-2 text-xs font-medium border rounded-lg hover:bg-muted text-muted-foreground transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {isLoading && <div className="text-center py-16 text-muted-foreground">Loading...</div>}

      {!isLoading && (
        <div className="rounded-xl border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Invoice No</th>
                <th className="text-left px-4 py-3 font-medium">Patient</th>
                <th className="text-right px-4 py-3 font-medium">Total</th>
                <th className="text-right px-4 py-3 font-medium">Paid</th>
                <th className="text-center px-4 py-3 font-medium">Mode</th>
                <th className="text-center px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Date</th>
                <th className="text-center px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {invoices.map((inv: any) => (
                <tr key={inv.id} className="hover:bg-muted/50">
                  <td className="px-4 py-3 font-mono text-xs font-medium">{inv.invoiceNo}</td>
                  <td className="px-4 py-3">
                    {inv.patientName ? (
                      <span className="font-medium text-slate-800">{inv.patientName}</span>
                    ) : inv.patient ? (
                      <span className="font-medium text-slate-800">
                        {inv.patient.name ?? `${inv.patient.firstName ?? ""} ${inv.patient.lastName ?? ""}`.trim()}
                      </span>
                    ) : inv.patientId ? (
                      <span className="font-mono text-xs text-muted-foreground">{inv.patientId.slice(0, 8)}…</span>
                    ) : (
                      <span className="text-muted-foreground">Walk-in</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">
                    ₹{parseFloat(inv.totalAmount).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    ₹{parseFloat(inv.amountPaid).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-center capitalize text-xs">{inv.paymentMode}</td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                        statusColor[inv.status] ?? "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {inv.status.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(inv.createdAt).toLocaleString("en-IN", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <PdfButton invoiceId={inv.id} />
                      {(inv.status === "paid" || inv.status === "confirmed" || inv.status === "partially_paid") && (
                        <>
                          <button
                            onClick={() => setReturnTarget(inv)}
                            className="flex items-center gap-1 text-xs text-amber-600 hover:underline"
                            title="Create return"
                          >
                            <RotateCcw size={12} /> Return
                          </button>
                          <button
                            onClick={() => setVoidTarget(inv)}
                            className="flex items-center gap-1 text-xs text-red-500 hover:underline"
                            title="Void invoice"
                          >
                            <XCircle size={12} /> Void
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-muted-foreground">
                    No invoices yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {meta && (
        <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
          <span>{meta.total} total</span>
          <div className="flex gap-2">
            <button
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1 border rounded-lg disabled:opacity-40 hover:bg-muted"
            >
              Prev
            </button>
            <button
              disabled={page >= meta.totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1 border rounded-lg disabled:opacity-40 hover:bg-muted"
            >
              Next
            </button>
          </div>
        </div>
      )}

      <VoidModal invoice={voidTarget} open={!!voidTarget} onClose={() => setVoidTarget(null)} />
      <ReturnModal invoice={returnTarget} open={!!returnTarget} onClose={() => setReturnTarget(null)} />

      <EodSummary />
    </div>
  );
}
