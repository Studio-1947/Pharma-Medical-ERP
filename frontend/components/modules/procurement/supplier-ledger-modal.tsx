"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { Modal } from "@/components/ui/modal";
import { ExportButton } from "@/components/shared/export-button";
import { ChevronDown, ChevronRight, Wallet, BookOpen, RotateCcw } from "lucide-react";

interface Supplier {
  id: string;
  name: string;
  code: string;
  creditDays?: number;
  creditLimit?: string;
  outstandingBalance?: string;
}

interface LedgerEntry {
  date: string;
  type: "bill" | "payment" | "credit_note";
  reference: string;
  debit: string;
  credit: string;
  balance: string;
}

interface BillItem {
  batchId: string | null;
  medicineName: string | null;
  batchNo: string;
  receivedQty: number;
  unitCost: string;
  taxPct: string;
  discountPct: string;
  freeQty: number;
  billedQty: number;
  lineTotal: string;
  isConsignment: boolean;
  dueAmount: string;
  soldQty?: number;
}

interface SupplierReturn {
  id: string;
  batchId: string;
  quantity: number;
  reason: "expiry" | "damage" | "other";
  outcome: "pending" | "replacement" | "credit_note";
  creditNoteAmount: string | null;
  notes: string | null;
  createdAt: string;
  resolvedAt: string | null;
  batch?: { batchNo: string; medicine?: { name: string } };
}

interface Bill {
  grnId: string;
  grnNumber: string;
  receivedAt: string;
  dueDate: string;
  supplierInvoiceNo: string | null;
  items: BillItem[];
  itemCount: number;
  totalQty: number;
  totalAmount: string;
  amountDue: string;
  paidAmount: string;
  balance: string;
  status: "paid" | "partial" | "unpaid";
}

const statusStyles: Record<Bill["status"], string> = {
  paid: "bg-emerald-50 text-emerald-700 border-emerald-100",
  partial: "bg-amber-50 text-amber-700 border-amber-100",
  unpaid: "bg-red-50 text-red-600 border-red-100",
};

const returnOutcomeStyles: Record<SupplierReturn["outcome"], string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-100",
  replacement: "bg-blue-50 text-blue-700 border-blue-100",
  credit_note: "bg-emerald-50 text-emerald-700 border-emerald-100",
};

const inr = (v: string | number) => `₹${parseFloat(String(v)).toFixed(2)}`;

const emptyPaymentForm = {
  grnId: "",
  amount: "",
  method: "cash",
  referenceNo: "",
  notes: "",
};

const emptyReturnForm = {
  batchId: "",
  medicineLabel: "",
  quantity: 1,
  reason: "expiry" as SupplierReturn["reason"],
  notes: "",
};

export function SupplierLedgerModal({
  supplier,
  open,
  onClose,
}: {
  supplier: Supplier;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { success: toastSuccess, error: toastError } = useToast();

  const [tab, setTab] = useState<"ledger" | "bills" | "returns">("ledger");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [billStatus, setBillStatus] = useState<"" | Bill["status"]>("");
  const [expandedBillId, setExpandedBillId] = useState<string | null>(null);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentForm, setPaymentForm] = useState(emptyPaymentForm);
  const [showReturnForm, setShowReturnForm] = useState(false);
  const [returnForm, setReturnForm] = useState(emptyReturnForm);
  const [resolvingReturnId, setResolvingReturnId] = useState<string | null>(null);
  const [resolveMode, setResolveMode] = useState<"replace" | "credit-note" | null>(null);
  const [resolveForm, setResolveForm] = useState({ batchNo: "", expiryDate: "", amount: "", grnId: "", notes: "" });

  const ledgerQuery = useQuery({
    queryKey: ["supplier-ledger", supplier.id, from, to],
    queryFn: () =>
      apiClient.get(`/procurement/suppliers/${supplier.id}/ledger`, {
        params: { from: from || undefined, to: to || undefined },
      }),
    enabled: open && tab === "ledger",
  });

  const billsQuery = useQuery({
    queryKey: ["supplier-bills", supplier.id, billStatus],
    queryFn: () =>
      apiClient.get(`/procurement/suppliers/${supplier.id}/bills`, {
        params: { status: billStatus || undefined },
      }),
    enabled: open,
  });

  const returnsQuery = useQuery({
    queryKey: ["supplier-returns", supplier.id],
    queryFn: () => apiClient.get(`/procurement/suppliers/${supplier.id}/returns`),
    enabled: open && tab === "returns",
  });

  const ledger = (ledgerQuery.data as any)?.data as
    | { openingBalance: string; entries: LedgerEntry[]; closingBalance: string; consignmentPayable: string }
    | undefined;
  const bills = ((billsQuery.data as any)?.data ?? []) as Bill[];
  const openBills = bills.filter((b) => b.status !== "paid");
  const returns = ((returnsQuery.data as any)?.data ?? []) as SupplierReturn[];

  const paymentMutation = useMutation({
    mutationFn: (data: typeof paymentForm) =>
      apiClient.post(`/procurement/suppliers/${supplier.id}/payments`, {
        grnId: data.grnId || undefined,
        amount: data.amount,
        method: data.method,
        referenceNo: data.referenceNo || undefined,
        notes: data.notes || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-ledger", supplier.id] });
      queryClient.invalidateQueries({ queryKey: ["supplier-bills", supplier.id] });
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      toastSuccess("Payment recorded", "The supplier's outstanding balance has been updated.");
      setShowPaymentForm(false);
      setPaymentForm(emptyPaymentForm);
    },
    onError: (err: any) =>
      toastError("Payment failed", err?.response?.data?.message ?? "Could not record this payment."),
  });

  function openPaymentForm(grnId?: string) {
    setPaymentForm({ ...emptyPaymentForm, grnId: grnId ?? "" });
    setShowPaymentForm(true);
  }

  function submitPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!paymentForm.amount || parseFloat(paymentForm.amount) <= 0) {
      toastError("Invalid amount", "Enter a payment amount greater than zero.");
      return;
    }
    paymentMutation.mutate(paymentForm);
  }

  const returnMutation = useMutation({
    mutationFn: (data: typeof returnForm) =>
      apiClient.post(`/procurement/returns`, {
        batchId: data.batchId,
        quantity: data.quantity,
        reason: data.reason,
        notes: data.notes || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-returns", supplier.id] });
      queryClient.invalidateQueries({ queryKey: ["supplier-bills", supplier.id] });
      toastSuccess("Return recorded", "The expired stock has been removed from sellable inventory.");
      setShowReturnForm(false);
      setReturnForm(emptyReturnForm);
    },
    onError: (err: any) =>
      toastError("Return failed", err?.response?.data?.message ?? "Could not record this return."),
  });

  function openReturnForm(item?: BillItem) {
    setReturnForm({
      ...emptyReturnForm,
      batchId: item?.batchId ?? "",
      medicineLabel: item ? `${item.medicineName ?? "—"} · ${item.batchNo}` : "",
      quantity: item ? Math.max(1, item.receivedQty) : 1,
    });
    setShowReturnForm(true);
    setTab("returns");
  }

  function submitReturn(e: React.FormEvent) {
    e.preventDefault();
    if (!returnForm.batchId) {
      toastError("Batch required", "Pick a batch from a bill's item list first (Bills tab → expand a bill → Return).");
      return;
    }
    if (returnForm.quantity <= 0) {
      toastError("Invalid quantity", "Enter a quantity greater than zero.");
      return;
    }
    returnMutation.mutate(returnForm);
  }

  const replaceMutation = useMutation({
    mutationFn: ({ id, batchNo, expiryDate }: { id: string; batchNo: string; expiryDate: string }) =>
      apiClient.post(`/procurement/returns/${id}/replace`, { batchNo, expiryDate }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-returns", supplier.id] });
      toastSuccess("Return resolved", "Replacement stock has been added to inventory.");
      setResolvingReturnId(null);
      setResolveMode(null);
    },
    onError: (err: any) =>
      toastError("Failed", err?.response?.data?.message ?? "Could not resolve this return."),
  });

  const creditNoteMutation = useMutation({
    mutationFn: ({ id, amount, grnId, notes }: { id: string; amount: string; grnId: string; notes: string }) =>
      apiClient.post(`/procurement/returns/${id}/credit-note`, {
        amount,
        grnId: grnId || undefined,
        notes: notes || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-returns", supplier.id] });
      queryClient.invalidateQueries({ queryKey: ["supplier-ledger", supplier.id] });
      queryClient.invalidateQueries({ queryKey: ["supplier-bills", supplier.id] });
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      toastSuccess("Return resolved", "A credit note has been applied to the supplier's balance.");
      setResolvingReturnId(null);
      setResolveMode(null);
    },
    onError: (err: any) =>
      toastError("Failed", err?.response?.data?.message ?? "Could not resolve this return."),
  });

  function openResolve(returnId: string, mode: "replace" | "credit-note") {
    setResolvingReturnId(returnId);
    setResolveMode(mode);
    setResolveForm({ batchNo: "", expiryDate: "", amount: "", grnId: "", notes: "" });
  }

  function submitResolve(e: React.FormEvent) {
    e.preventDefault();
    if (!resolvingReturnId) return;
    if (resolveMode === "replace") {
      if (!resolveForm.batchNo.trim() || !resolveForm.expiryDate) {
        toastError("Missing details", "Batch number and expiry date are required.");
        return;
      }
      replaceMutation.mutate({ id: resolvingReturnId, batchNo: resolveForm.batchNo, expiryDate: resolveForm.expiryDate });
    } else if (resolveMode === "credit-note") {
      if (!resolveForm.amount || parseFloat(resolveForm.amount) <= 0) {
        toastError("Invalid amount", "Enter a credit note amount greater than zero.");
        return;
      }
      creditNoteMutation.mutate({
        id: resolvingReturnId,
        amount: resolveForm.amount,
        grnId: resolveForm.grnId,
        notes: resolveForm.notes,
      });
    }
  }

  return (
    <Modal
      title={`${supplier.name} — Ledger`}
      subtitle={`${supplier.code} · Credit ${supplier.creditDays ?? 0} days`}
      open={open}
      onClose={onClose}
      size="2xl"
      icon={<BookOpen className="w-4 h-4" />}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 border rounded-xl px-4 py-3">
          <div>
            <p className="text-xs font-semibold text-slate-400">Current Outstanding</p>
            <p
              className={`text-xl font-bold ${
                parseFloat(supplier.outstandingBalance ?? "0") > 0 ? "text-red-600" : "text-slate-700"
              }`}
            >
              {inr(supplier.outstandingBalance ?? "0")}
            </p>
          </div>
          {ledger && parseFloat(ledger.consignmentPayable) > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-400">Consignment Payable</p>
              <p className="text-xl font-bold text-blue-600">{inr(ledger.consignmentPayable)}</p>
              <p className="text-[10px] text-slate-400">Owed only for units already sold</p>
            </div>
          )}
          <div className="text-right text-xs text-slate-500">
            <p>Credit limit: {inr(supplier.creditLimit ?? "0")}</p>
          </div>
          <button
            onClick={() => openPaymentForm()}
            className="inline-flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-emerald-700 transition-colors shadow-sm"
          >
            <Wallet className="w-4 h-4" /> Record Payment
          </button>
        </div>

        {showPaymentForm && (
          <form
            onSubmit={submitPayment}
            className="space-y-3 border rounded-xl p-4 bg-white animate-in fade-in"
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold">Amount (₹) *</label>
                <input
                  type="text"
                  inputMode="decimal"
                  required
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold">Method</label>
                <select
                  value={paymentForm.method}
                  onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                >
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="cheque">Cheque</option>
                  <option value="upi">UPI</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold">Reference No.</label>
                <input
                  type="text"
                  value={paymentForm.referenceNo}
                  onChange={(e) => setPaymentForm({ ...paymentForm, referenceNo: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  placeholder="Cheque no. / UTR / UPI ref"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold">Apply to Bill</label>
                <select
                  value={paymentForm.grnId}
                  onChange={(e) => setPaymentForm({ ...paymentForm, grnId: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                >
                  <option value="">On account (unallocated)</option>
                  {openBills.map((b) => (
                    <option key={b.grnId} value={b.grnId}>
                      {b.grnNumber} — balance {inr(b.balance)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold">Notes</label>
              <input
                type="text"
                value={paymentForm.notes}
                onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowPaymentForm(false)}
                className="px-3 py-1.5 border rounded-lg text-xs font-semibold hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={paymentMutation.isPending}
                className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-60"
              >
                {paymentMutation.isPending ? "Saving..." : "Save Payment"}
              </button>
            </div>
          </form>
        )}

        <div className="flex gap-1 border-b">
          <button
            onClick={() => setTab("ledger")}
            className={`px-3 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === "ledger" ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500"
            }`}
          >
            Ledger
          </button>
          <button
            onClick={() => setTab("bills")}
            className={`px-3 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === "bills" ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500"
            }`}
          >
            Bills
          </button>
          <button
            onClick={() => setTab("returns")}
            className={`px-3 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === "returns" ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500"
            }`}
          >
            Returns
          </button>
        </div>

        {tab === "ledger" && (
          <div className="space-y-3">
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
                url={`/procurement/suppliers/${supplier.id}/ledger`}
                params={{ from: from || undefined, to: to || undefined }}
                filename={`ledger-${supplier.code}.csv`}
                className="ml-auto flex items-center gap-2 px-3 py-1.5 border rounded-lg text-xs font-semibold hover:bg-muted transition-colors"
              />
            </div>

            {ledgerQuery.isLoading ? (
              <div className="animate-pulse h-40 bg-muted rounded-xl" />
            ) : !ledger || ledger.entries.length === 0 ? (
              <div className="text-center py-10 text-sm text-muted-foreground">No transactions yet.</div>
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
                        <td className="px-3 py-2">{e.date.slice(0, 10)}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                              e.type === "bill"
                                ? "bg-red-50 text-red-600 border-red-100"
                                : e.type === "credit_note"
                                  ? "bg-blue-50 text-blue-700 border-blue-100"
                                  : "bg-emerald-50 text-emerald-700 border-emerald-100"
                            }`}
                          >
                            {e.type === "bill" ? "Bill" : e.type === "credit_note" ? "Credit Note" : "Payment"}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{e.reference}</td>
                        <td className="px-3 py-2 text-right">{parseFloat(e.debit) > 0 ? inr(e.debit) : "—"}</td>
                        <td className="px-3 py-2 text-right">{parseFloat(e.credit) > 0 ? inr(e.credit) : "—"}</td>
                        <td className="px-3 py-2 text-right font-semibold">{inr(e.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === "bills" && (
          <div className="space-y-3">
            <select
              value={billStatus}
              onChange={(e) => setBillStatus(e.target.value as any)}
              className="border rounded-lg px-3 py-1.5 text-sm bg-background"
            >
              <option value="">All bills</option>
              <option value="unpaid">Unpaid</option>
              <option value="partial">Partially paid</option>
              <option value="paid">Paid</option>
            </select>

            {billsQuery.isLoading ? (
              <div className="animate-pulse h-40 bg-muted rounded-xl" />
            ) : bills.length === 0 ? (
              <div className="text-center py-10 text-sm text-muted-foreground">No bills found.</div>
            ) : (
              <div className="space-y-2">
                {bills.map((bill) => {
                  const expanded = expandedBillId === bill.grnId;
                  return (
                    <div key={bill.grnId} className="border rounded-xl overflow-hidden">
                      <button
                        onClick={() => setExpandedBillId(expanded ? null : bill.grnId)}
                        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors text-left"
                      >
                        <div className="flex items-center gap-2">
                          {expanded ? (
                            <ChevronDown className="w-4 h-4 text-slate-400" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-slate-400" />
                          )}
                          <div>
                            <p className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                              {bill.grnNumber}
                              {bill.items.some((i) => i.isConsignment) && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-blue-50 text-blue-700 border-blue-100">
                                  CONSIGNMENT
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-slate-500">
                              {bill.receivedAt.slice(0, 10)} · {bill.itemCount} item
                              {bill.itemCount === 1 ? "" : "s"} · {bill.totalQty} units · due{" "}
                              {bill.dueDate.slice(0, 10)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${statusStyles[bill.status]}`}>
                            {bill.status.toUpperCase()}
                          </span>
                          <div className="text-right">
                            <span className="text-sm font-bold text-slate-800">{inr(bill.amountDue)}</span>
                            {bill.amountDue !== bill.totalAmount && (
                              <p className="text-[10px] text-slate-400">of {inr(bill.totalAmount)} total</p>
                            )}
                          </div>
                          {bill.status !== "paid" && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openPaymentForm(bill.grnId);
                              }}
                              className="text-xs font-semibold text-emerald-700 hover:underline"
                            >
                              Pay
                            </button>
                          )}
                        </div>
                      </button>

                      {expanded && (
                        <div className="border-t bg-slate-50 px-4 py-3 space-y-2">
                          <table className="w-full text-xs">
                            <thead className="text-slate-400 uppercase tracking-wide">
                              <tr>
                                <th className="text-left py-1">Medicine</th>
                                <th className="text-left py-1">Batch</th>
                                <th className="text-right py-1">Rcvd</th>
                                <th className="text-right py-1">Free</th>
                                <th className="text-right py-1">Billed</th>
                                <th className="text-right py-1">Unit Cost</th>
                                <th className="text-right py-1">Disc %</th>
                                <th className="text-right py-1">Tax %</th>
                                <th className="text-right py-1">Line Total</th>
                                <th className="text-right py-1">Due Now</th>
                                <th className="py-1" />
                              </tr>
                            </thead>
                            <tbody>
                              {bill.items.map((item, i) => (
                                <tr key={i} className="border-t border-slate-200">
                                  <td className="py-1.5">
                                    {item.medicineName ?? "—"}
                                    {item.isConsignment && (
                                      <span className="ml-1 text-[9px] font-semibold px-1 py-0.5 rounded border bg-blue-50 text-blue-700 border-blue-100">
                                        CONSIGN
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-1.5 font-mono">{item.batchNo}</td>
                                  <td className="py-1.5 text-right">{item.receivedQty}</td>
                                  <td className="py-1.5 text-right">{item.freeQty > 0 ? item.freeQty : "—"}</td>
                                  <td className="py-1.5 text-right">{item.billedQty}</td>
                                  <td className="py-1.5 text-right">{inr(item.unitCost)}</td>
                                  <td className="py-1.5 text-right">
                                    {parseFloat(item.discountPct) > 0 ? `${item.discountPct}%` : "—"}
                                  </td>
                                  <td className="py-1.5 text-right">{item.taxPct}%</td>
                                  <td className="py-1.5 text-right font-semibold">{inr(item.lineTotal)}</td>
                                  <td className="py-1.5 text-right">
                                    {item.isConsignment ? (
                                      <span title={`${item.soldQty ?? 0} of ${item.billedQty} sold`}>
                                        {inr(item.dueAmount)}
                                      </span>
                                    ) : (
                                      "—"
                                    )}
                                  </td>
                                  <td className="py-1.5 text-right">
                                    {item.batchId && (
                                      <button
                                        type="button"
                                        onClick={() => openReturnForm(item)}
                                        className="text-[10px] font-semibold text-red-600 hover:underline inline-flex items-center gap-1"
                                      >
                                        <RotateCcw className="w-3 h-3" /> Return
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <div className="flex justify-end gap-6 text-xs pt-2 border-t border-slate-200">
                            <span>
                              Paid: <span className="font-semibold">{inr(bill.paidAmount)}</span>
                            </span>
                            <span>
                              Balance: <span className="font-semibold">{inr(bill.balance)}</span>
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === "returns" && (
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <p className="text-xs text-muted-foreground">
                Record a return from a bill&apos;s item list (Bills tab → expand a bill → Return), or resolve one below.
              </p>
              {!showReturnForm && (
                <button
                  type="button"
                  onClick={() => openReturnForm()}
                  className="text-xs font-semibold text-red-600 hover:underline inline-flex items-center gap-1"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Record Return
                </button>
              )}
            </div>

            {showReturnForm && (
              <form onSubmit={submitReturn} className="space-y-3 border rounded-xl p-4 bg-white animate-in fade-in">
                <div className="text-xs font-semibold text-slate-700">
                  {returnForm.medicineLabel || "Pick an item from the Bills tab first"}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold">Quantity *</label>
                    <input
                      type="number"
                      min={1}
                      required
                      value={returnForm.quantity}
                      onChange={(e) => setReturnForm({ ...returnForm, quantity: Number(e.target.value) })}
                      className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold">Reason</label>
                    <select
                      value={returnForm.reason}
                      onChange={(e) => setReturnForm({ ...returnForm, reason: e.target.value as any })}
                      className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    >
                      <option value="expiry">Expiry</option>
                      <option value="damage">Damage</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold">Notes</label>
                  <input
                    type="text"
                    value={returnForm.notes}
                    onChange={(e) => setReturnForm({ ...returnForm, notes: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowReturnForm(false)}
                    className="px-3 py-1.5 border rounded-lg text-xs font-semibold hover:bg-muted transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={returnMutation.isPending}
                    className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-semibold hover:bg-red-700 transition-colors disabled:opacity-60"
                  >
                    {returnMutation.isPending ? "Saving..." : "Record Return"}
                  </button>
                </div>
              </form>
            )}

            {returnsQuery.isLoading ? (
              <div className="animate-pulse h-40 bg-muted rounded-xl" />
            ) : returns.length === 0 ? (
              <div className="text-center py-10 text-sm text-muted-foreground">No returns recorded.</div>
            ) : (
              <div className="space-y-2">
                {returns.map((ret) => (
                  <div key={ret.id} className="border rounded-xl px-4 py-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">
                          {ret.batch?.medicine?.name ?? "Medicine"} · {ret.batch?.batchNo ?? "—"}
                        </p>
                        <p className="text-xs text-slate-500">
                          {ret.createdAt.slice(0, 10)} · {ret.quantity} units · {ret.reason}
                        </p>
                      </div>
                      <span
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${returnOutcomeStyles[ret.outcome]}`}
                      >
                        {ret.outcome === "credit_note" ? "CREDIT NOTE" : ret.outcome.toUpperCase()}
                      </span>
                    </div>

                    {ret.outcome === "credit_note" && ret.creditNoteAmount && (
                      <p className="text-xs text-slate-600">Credited: {inr(ret.creditNoteAmount)}</p>
                    )}

                    {ret.outcome === "pending" && resolvingReturnId !== ret.id && (
                      <div className="flex gap-3 pt-1">
                        <button
                          type="button"
                          onClick={() => openResolve(ret.id, "replace")}
                          className="text-xs font-semibold text-blue-700 hover:underline"
                        >
                          Mark Replaced
                        </button>
                        <button
                          type="button"
                          onClick={() => openResolve(ret.id, "credit-note")}
                          className="text-xs font-semibold text-emerald-700 hover:underline"
                        >
                          Issue Credit Note
                        </button>
                      </div>
                    )}

                    {resolvingReturnId === ret.id && resolveMode === "replace" && (
                      <form onSubmit={submitResolve} className="border-t pt-3 mt-1 space-y-2">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-xs font-semibold">New Batch No *</label>
                            <input
                              required
                              value={resolveForm.batchNo}
                              onChange={(e) => setResolveForm({ ...resolveForm, batchNo: e.target.value })}
                              className="w-full border rounded-lg px-2 py-1.5 text-xs"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-semibold">Expiry Date *</label>
                            <input
                              type="date"
                              required
                              value={resolveForm.expiryDate}
                              onChange={(e) => setResolveForm({ ...resolveForm, expiryDate: e.target.value })}
                              className="w-full border rounded-lg px-2 py-1.5 text-xs"
                            />
                          </div>
                        </div>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setResolvingReturnId(null)}
                            className="px-3 py-1.5 border rounded-lg text-xs font-semibold hover:bg-muted"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={replaceMutation.isPending}
                            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 disabled:opacity-60"
                          >
                            {replaceMutation.isPending ? "Saving..." : "Confirm Replacement"}
                          </button>
                        </div>
                      </form>
                    )}

                    {resolvingReturnId === ret.id && resolveMode === "credit-note" && (
                      <form onSubmit={submitResolve} className="border-t pt-3 mt-1 space-y-2">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-xs font-semibold">Credit Amount (₹) *</label>
                            <input
                              type="text"
                              inputMode="decimal"
                              required
                              value={resolveForm.amount}
                              onChange={(e) => setResolveForm({ ...resolveForm, amount: e.target.value })}
                              className="w-full border rounded-lg px-2 py-1.5 text-xs"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-semibold">Apply to Bill</label>
                            <select
                              value={resolveForm.grnId}
                              onChange={(e) => setResolveForm({ ...resolveForm, grnId: e.target.value })}
                              className="w-full border rounded-lg px-2 py-1.5 text-xs"
                            >
                              <option value="">On account (later, supplier&apos;s convenience)</option>
                              {openBills.map((b) => (
                                <option key={b.grnId} value={b.grnId}>
                                  {b.grnNumber} — balance {inr(b.balance)}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setResolvingReturnId(null)}
                            className="px-3 py-1.5 border rounded-lg text-xs font-semibold hover:bg-muted"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={creditNoteMutation.isPending}
                            className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700 disabled:opacity-60"
                          >
                            {creditNoteMutation.isPending ? "Saving..." : "Confirm Credit Note"}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
