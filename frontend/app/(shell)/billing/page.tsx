"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { apiClient, queryKeys } from "@/lib/api-client";
import { ShoppingCart, XCircle, RotateCcw, AlertCircle, Download, Search, BarChart2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";

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
      setError(err?.response?.data?.message ?? "Failed to void invoice."),
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

  const { data: detailRaw, isLoading: loadingDetail } = useQuery({
    queryKey: ["invoice-detail", invoice?.id],
    queryFn: () => apiClient.get(`/billing/invoices/${invoice!.id}`),
    enabled: open && !!invoice?.id,
  });

  const items: any[] = (detailRaw as any)?.items ?? (detailRaw as any)?.data?.items ?? [];

  const mutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) =>
      apiClient.post(`/billing/invoices/${id}/return`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.invoices.all() });
      setReason("");
      setReturnQtys({});
      onClose();
    },
    onError: (err: any) =>
      setError(err?.response?.data?.message ?? "Failed to create return."),
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
        {loadingDetail ? (
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
  const [page, setPage] = useState(1);
  const [voidTarget, setVoidTarget] = useState<any | null>(null);
  const [returnTarget, setReturnTarget] = useState<any | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

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
  });

  const invoices: any[] = (data as any)?.data ?? [];
  const meta = (data as any)?.meta;

  function handleFilterChange() {
    setPage(1);
  }

  const statusColor: Record<string, string> = {
    confirmed: "bg-blue-100 text-blue-700",
    paid: "bg-green-100 text-green-700",
    partially_paid: "bg-amber-100 text-amber-700",
    cancelled: "bg-red-100 text-red-700",
    void: "bg-red-100 text-red-700",
    draft: "bg-gray-100 text-gray-600",
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-semibold">Billing</h2>
        <Link
          href="/billing/pos"
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90"
        >
          <ShoppingCart size={16} /> Open POS
        </Link>
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
                    {inv.patient ? (
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
