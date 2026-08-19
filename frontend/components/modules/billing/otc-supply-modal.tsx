"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Pill,
  Package,
  AlertTriangle,
  CheckCircle2,
  Receipt,
  Gift,
  IndianRupee,
} from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { apiClient, queryKeys } from "@/lib/api-client";
import { useActiveBranchId } from "@/hooks/use-branch";
import { usePermissions } from "@/hooks/use-permissions";
import { formatStockUnit, getUnitLabel } from "@/lib/stock-unit-formatter";
import { quoteOtcSale } from "@/lib/otc-quote";
import { scheduleLabel } from "@/lib/schedule-class";
import { InvoiceDetailModal } from "./invoice-detail-modal";

/**
 * OTC counter supply — a medicine handed over without a prescription.
 *
 * Two paths, because a pharmacy does both and they are not the same event:
 *
 *  - "Bill it" (the default): the customer pays. This is a sale like any
 *    other, so it goes through the normal invoice route — server-side FEFO,
 *    price from the batch, per-line discount, GST split, payment mode,
 *    invoice number, timestamp. Without a bill the money never reached the
 *    day-end tally, the GST return or the cash reconciliation, and the stock
 *    left the shelf with no revenue recorded against it.
 *
 *  - "Free / no charge": genuine samples, staff medicine, counter hand-outs.
 *    No money changes hands, so no bill is issued; stock is decremented and
 *    an `otc_supply` ledger movement records what left and why.
 */

type OtcMedicine = {
  id: string;
  name: string;
  sku?: string | null;
  priceMrp?: string | number | null;
  taxPercent?: string | number | null;
  stripSize?: string | number | null;
  unit?: string | null;
  dosageForm?: string | null;
  scheduleClass?: string | null;
  requiresPrescription?: boolean | null;
};


function inr(n: number) {
  return `₹${n.toFixed(2)}`;
}

export function OtcSupplyModal({
  medicine,
  onClose,
}: {
  medicine: OtcMedicine | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { branchId: activeBranchId } = useActiveBranchId();
  const { success: toastSuccess, error: toastError } = useToast();
  const { can } = usePermissions();

  const canBill = can("billing.create");
  const canGiveFree = can("inventory.adjust");

  const [mode, setMode] = useState<"bill" | "free">("bill");
  const [saleUnit, setSaleUnit] = useState<"pack" | "loose">("pack");
  const [quantity, setQuantity] = useState(1);
  const [discountPct, setDiscountPct] = useState(0);
  const [paymentMode, setPaymentMode] = useState<"cash" | "upi" | "card">("cash");
  const [referenceNo, setReferenceNo] = useState("");
  const [batchId, setBatchId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [billedInvoiceId, setBilledInvoiceId] = useState<string | null>(null);

  const open = !!medicine;

  // The parent keeps this component mounted between hand-outs, so without
  // this the next medicine opens carrying the last one's quantity, discount
  // and note.
  useEffect(() => {
    setQuantity(1);
    setDiscountPct(0);
    setReferenceNo("");
    setNotes("");
    setBatchId("");
    setSaleUnit("pack");
    setBilledInvoiceId(null);
  }, [medicine?.id]);

  const { data: batchesRaw, isLoading } = useQuery({
    queryKey: ["otc-supply-batches", medicine?.id, activeBranchId],
    queryFn: () =>
      apiClient.get(`/inventory/medicines/${medicine!.id}/batches`, {
        params: { branchId: activeBranchId },
      }) as any,
    enabled: open,
  });

  // Memoised so the price quote below is not recomputed on every keystroke
  // over a fresh array identity.
  const batches: any[] = useMemo(() => {
    const raw = batchesRaw as any;
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw?.data?.data)) return raw.data.data;
    if (Array.isArray(raw?.data)) return raw.data;
    return [];
  }, [batchesRaw]);

  const selectedBatch = batches.find((b) => b.id === batchId) ?? batches[0] ?? null;

  const stripSize = Math.max(1, Number(medicine?.stripSize ?? 1) || 1);
  const taxPct = Number(medicine?.taxPercent ?? 0) || 0;
  // Shape the unit formatters expect — stripSize arrives as a numeric string
  // from the API and would otherwise be compared as text.
  const unitInfo = {
    unit: medicine?.unit ?? null,
    dosageForm: medicine?.dosageForm ?? null,
    stripSize,
  };
  const schedule = scheduleLabel(medicine?.scheduleClass);
  const isControlled = !!medicine?.requiresPrescription || !!schedule;

  // Total sellable across every FEFO batch — the server allocates across
  // batches, so the ceiling is the pooled quantity, not one batch's.
  const totalAvailable = batches.reduce(
    (sum, b) => sum + Math.max(0, Number(b.quantity ?? 0) - Number(b.reservedQty ?? 0)),
    0,
  );

  // Quantity in the unit the invoice API speaks. Mirrors the POS exactly: a
  // pack line is sent as packs x stripSize, because the server prices per
  // loose unit (mrpAtEntry / stripSize).
  const baseUnits = saleUnit === "pack" ? quantity * stripSize : quantity;
  const maxQty = saleUnit === "pack" ? Math.floor(totalAvailable / stripSize) : totalAvailable;

  /**
   * Priced against the batches FEFO will actually pull from, line by line,
   * with the server's per-line rounding — so the amount tendered here is the
   * amount the server computes. A paisa of drift is not cosmetic: the invoice
   * route rejects both over-payment and an under-paid walk-in.
   */
  const quote = useMemo(
    () =>
      quoteOtcSale({
        batches,
        units: baseUnits,
        discountPct,
        taxPct,
        stripSize,
      }),
    [batches, baseUnits, discountPct, taxPct, stripSize],
  );

  const resetAndClose = () => {
    setBilledInvoiceId(null);
    setQuantity(1);
    setDiscountPct(0);
    setReferenceNo("");
    setNotes("");
    setBatchId("");
    onClose();
  };

  // ── Billed OTC sale — the normal invoice route ────────────────────────────
  const billMutation = useMutation({
    mutationFn: () =>
      apiClient.post("/billing/invoices", {
        branchId: activeBranchId,
        items: [
          {
            medicineId: medicine!.id,
            quantity: baseUnits,
            discountPct: discountPct.toFixed(2),
          },
        ],
        payments: [
          {
            mode: paymentMode,
            amount: quote.total.toFixed(2),
            ...(referenceNo.trim() ? { referenceNo: referenceNo.trim() } : {}),
          },
        ],
        discountAmount: "0",
        notes: ["OTC counter sale — no prescription", notes.trim()]
          .filter(Boolean)
          .join(" · "),
        // Same idempotency guard the POS uses: a retry after a lost response
        // returns the invoice already written instead of billing it twice.
        clientRef: `OTC-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      }) as any,
    onSuccess: (res: any) => {
      const invoice = res?.data?.invoice ?? res?.data?.data ?? res?.data ?? res;
      qc.invalidateQueries({ queryKey: ["otc-supply-batches"] });
      qc.invalidateQueries({ queryKey: ["counter-low-stock"] });
      qc.invalidateQueries({ queryKey: ["counter-served-today"] });
      qc.invalidateQueries({ queryKey: ["medicine-batches-detail"] });
      qc.invalidateQueries({ queryKey: queryKeys.invoices.all() });
      qc.invalidateQueries({ queryKey: queryKeys.medicines.list({}) });
      toastSuccess(
        "OTC sale billed",
        `${invoice?.invoiceNo ? `Bill ${invoice.invoiceNo}` : "Bill created"} — ${inr(quote.total)} received by ${paymentMode.toUpperCase()}.`,
      );
      if (invoice?.id) setBilledInvoiceId(invoice.id);
      else resetAndClose();
    },
    onError: (err: any) => {
      toastError(
        "Sale not completed",
        err?.response?.data?.message ?? "Could not bill this OTC sale.",
      );
    },
  });

  // ── Free hand-out — ledger movement only, no bill ─────────────────────────
  const freeMutation = useMutation({
    mutationFn: () =>
      apiClient.post(`/inventory/batches/${batchId || selectedBatch?.id}/otc-supply`, {
        quantity,
        branchId: activeBranchId,
        notes: notes.trim() || undefined,
      }) as any,
    onSuccess: (res: any) => {
      const data = res?.data ?? res;
      qc.invalidateQueries({ queryKey: ["otc-supply-batches"] });
      qc.invalidateQueries({ queryKey: ["counter-low-stock"] });
      qc.invalidateQueries({ queryKey: ["counter-otc-today"] });
      qc.invalidateQueries({ queryKey: ["medicine-batches-detail"] });
      qc.invalidateQueries({ queryKey: queryKeys.medicines.list({}) });
      toastSuccess(
        "Free hand-out recorded",
        `${data?.quantitySupplied ?? quantity} unit(s) of ${medicine?.name ?? "medicine"} given free — stock deducted, no bill.`,
      );
      resetAndClose();
    },
    onError: (err: any) => {
      toastError(
        "Hand-out failed",
        err?.response?.data?.message ?? "Could not record the free hand-out.",
      );
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "free") {
      if (!batchId && !selectedBatch) return;
      if (!batchId && selectedBatch) setBatchId(selectedBatch.id);
      freeMutation.mutate();
      return;
    }
    if (quote.short > 0 || quote.total <= 0) return;
    billMutation.mutate();
  };

  // After a successful sale the bill itself is the useful thing to look at —
  // the counter prints or shares it from here.
  if (billedInvoiceId) {
    return <InvoiceDetailModal invoiceId={billedInvoiceId} onClose={resetAndClose} />;
  }

  const unitLabel = getUnitLabel(quantity, unitInfo);
  const pending = billMutation.isPending || freeMutation.isPending;
  const freeMax = Number(selectedBatch?.quantity ?? 0);

  return (
    <Modal
      title={mode === "bill" ? "OTC Sale — No Prescription" : "Free Hand-out — No Bill"}
      subtitle={`${medicine?.name ?? "Medicine"}${medicine?.sku ? ` · ${medicine.sku}` : ""}`}
      icon={<Pill size={16} />}
      open={open}
      onClose={onClose}
      size="md"
    >
      {!medicine ? null : (
        <div className="space-y-4">
          {/* Mode switch */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!canBill}
              onClick={() => {
                setMode("bill");
                setQuantity((q) => Math.max(1, Math.min(q, maxQty || 1)));
              }}
              className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                mode === "bill"
                  ? "bg-orange-500 text-white border-orange-500 shadow-sm"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              }`}
            >
              <Receipt size={14} /> Bill it (customer pays)
            </button>
            <button
              type="button"
              disabled={!canGiveFree}
              onClick={() => {
                setMode("free");
                const cap = Number(selectedBatch?.quantity ?? 0);
                setQuantity((q) => Math.max(1, Math.min(q, cap || 1)));
              }}
              className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                mode === "free"
                  ? "bg-slate-800 text-white border-slate-800 shadow-sm"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              }`}
            >
              <Gift size={14} /> Free — no charge
            </button>
          </div>

          {mode === "bill" ? (
            <div className="flex items-start gap-2 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
              <Receipt size={14} className="shrink-0 mt-0.5" />
              <span>
                A proper bill is created — quantity, time, price, discount, GST
                and payment mode are all recorded, so this sale appears in the
                day-end tally, the sales report and the GST return.
              </span>
            </div>
          ) : (
            <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>
                No bill and no payment are created — this is money the shop does
                not collect. Stock is deducted and the hand-out is recorded in
                the movement ledger. Use it only for free samples, staff
                medicine and counter give-aways.
              </span>
            </div>
          )}

          {isControlled && mode === "bill" && (
            <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>
                {schedule ?? "This medicine"} needs a verified prescription.
                Bill it from the POS with the prescription linked — it cannot be
                sold over the counter here.
              </span>
            </div>
          )}

          {isLoading ? (
            <div className="py-10 text-center text-xs text-slate-400 animate-pulse">
              Loading active batches…
            </div>
          ) : batches.length === 0 ? (
            <div className="py-10 text-center">
              <Package size={26} className="mx-auto text-slate-300" />
              <p className="mt-2 text-sm font-semibold text-slate-600">
                No active stock found
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Receive stock for this medicine before supplying it.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === "free" ? (
                /* Batch picker — a free hand-out comes off one named batch */
                <div>
                  <label
                    htmlFor="otc-batch"
                    className="block text-xs font-bold text-slate-700 mb-1.5"
                  >
                    Batch (FEFO order — earliest expiry first)
                  </label>
                  <select
                    id="otc-batch"
                    value={batchId || selectedBatch?.id || ""}
                    onChange={(e) => setBatchId(e.target.value)}
                    required
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/30"
                  >
                    {batches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.batchNo} — {formatStockUnit(Number(b.quantity ?? 0), unitInfo)}
                        {b.expiryDate ? ` · exp ${b.expiryDate.slice(0, 7)}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                /* Billed sale: the server picks batches by FEFO, splitting
                   across them when one runs short — show what it will pull. */
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Batches used (FEFO — earliest expiry first)
                  </p>
                  {quote.used.length === 0 ? (
                    <p className="text-xs text-slate-500 mt-1">
                      Enter a quantity to see which batch is pulled.
                    </p>
                  ) : (
                    <ul className="mt-1 space-y-0.5">
                      {quote.used.map((u) => (
                        <li key={u.batchNo} className="text-xs text-slate-700 font-medium">
                          {u.batchNo} — {u.units} unit{u.units === 1 ? "" : "s"}
                          {u.expiryDate ? ` · exp ${u.expiryDate.slice(0, 7)}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* Sale unit — only meaningful when a pack holds more than one */}
              {mode === "bill" && stripSize > 1 && (
                <div>
                  <p
                    id="otc-saleunit-label"
                    className="block text-xs font-bold text-slate-700 mb-1.5"
                  >
                    Sold as
                  </p>
                  <div className="grid grid-cols-2 gap-2" role="group" aria-labelledby="otc-saleunit-label">
                    {(["pack", "loose"] as const).map((u) => (
                      <button
                        key={u}
                        type="button"
                        onClick={() => {
                          setSaleUnit(u);
                          // A quantity typed in loose units would otherwise
                          // become that many full packs.
                          const cap =
                            u === "pack"
                              ? Math.floor(totalAvailable / stripSize)
                              : totalAvailable;
                          setQuantity((q) => Math.max(1, Math.min(q, cap || 1)));
                        }}
                        className={`px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${
                          saleUnit === u
                            ? "bg-slate-800 text-white border-slate-800"
                            : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        {u === "pack"
                          ? `Full ${getUnitLabel(1, unitInfo)} (${stripSize})`
                          : "Loose units"}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Quantity + discount */}
              <div className={mode === "bill" ? "grid grid-cols-2 gap-3" : ""}>
                <div>
                  <label
                    htmlFor="otc-quantity"
                    className="block text-xs font-bold text-slate-700 mb-1.5"
                  >
                    Quantity {mode === "bill" ? `(${unitLabel})` : "to supply"}
                  </label>
                  <input
                    id="otc-quantity"
                    type="number"
                    min={1}
                    max={(mode === "free" ? freeMax : maxQty) || undefined}
                    value={quantity}
                    onChange={(e) => {
                      const cap = mode === "free" ? freeMax : maxQty;
                      setQuantity(Math.min(cap || 1, Math.max(1, Number(e.target.value) || 1)));
                    }}
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/30"
                  />
                  <p className="mt-1 text-[11px] text-slate-400">
                    Max {mode === "free" ? freeMax : maxQty} on{" "}
                    {mode === "free" ? "this batch" : "hand"}
                  </p>
                </div>

                {mode === "bill" && (
                  <div>
                    <label
                      htmlFor="otc-discount"
                      className="block text-xs font-bold text-slate-700 mb-1.5"
                    >
                      Discount %
                    </label>
                    <input
                      id="otc-discount"
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      value={discountPct}
                      onChange={(e) =>
                        setDiscountPct(
                          Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                        )
                      }
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/30"
                    />
                    <p className="mt-1 text-[11px] text-slate-400">
                      Comes off before GST is worked out
                    </p>
                  </div>
                )}
              </div>

              {mode === "bill" && (
                <>
                  {/* Payment */}
                  <div>
                    <p
                      id="otc-payment-label"
                      className="block text-xs font-bold text-slate-700 mb-1.5"
                    >
                      Payment received by
                    </p>
                    <div className="grid grid-cols-3 gap-2" role="group" aria-labelledby="otc-payment-label">
                      {(["cash", "upi", "card"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setPaymentMode(m)}
                          className={`px-3 py-2 rounded-lg text-xs font-bold uppercase border transition-colors ${
                            paymentMode === m
                              ? "bg-emerald-600 text-white border-emerald-600"
                              : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>

                  {paymentMode !== "cash" && (
                    <div>
                      <label
                        htmlFor="otc-reference"
                        className="block text-xs font-bold text-slate-700 mb-1.5"
                      >
                        Reference no{" "}
                        <span className="font-normal text-slate-400">(optional)</span>
                      </label>
                      <input
                        id="otc-reference"
                        value={referenceNo}
                        onChange={(e) => setReferenceNo(e.target.value)}
                        placeholder={
                          paymentMode === "upi" ? "UPI transaction ID" : "Card last 4 digits"
                        }
                        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/30"
                      />
                    </div>
                  )}

                  {/* Amount */}
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2.5 space-y-1">
                    <div className="flex justify-between text-xs text-slate-600">
                      <span>Taxable value{discountPct > 0 ? " (after discount)" : ""}</span>
                      <span className="font-semibold">{inr(quote.subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-xs text-slate-600">
                      <span>GST @ {taxPct}%</span>
                      <span className="font-semibold">{inr(quote.tax)}</span>
                    </div>
                    <div className="flex justify-between text-sm font-extrabold text-emerald-800 pt-1 border-t border-emerald-200">
                      <span className="flex items-center gap-1">
                        <IndianRupee size={13} /> To collect
                      </span>
                      <span>{inr(quote.total)}</span>
                    </div>
                  </div>

                  {quote.short > 0 && (
                    <p className="text-xs font-semibold text-red-600">
                      Not enough stock — {quote.short} more unit
                      {quote.short === 1 ? "" : "s"} needed than the branch holds.
                    </p>
                  )}
                </>
              )}

              {/* Notes */}
              <div>
                <label
                  htmlFor="otc-notes"
                  className="block text-xs font-bold text-slate-700 mb-1.5"
                >
                  Notes <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <input
                  id="otc-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={
                    mode === "bill"
                      ? "e.g. walk-in customer, phone order…"
                      : "e.g. free sample, staff medicine, counter hand-out…"
                  }
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/30"
                />
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    pending ||
                    (mode === "bill"
                      ? isControlled || !canBill || quote.short > 0 || quote.total <= 0
                      : !canGiveFree || freeMax <= 0)
                  }
                  className={`flex items-center gap-2 px-5 py-2 text-white text-xs font-extrabold rounded-lg disabled:opacity-50 transition-colors shadow-sm ${
                    mode === "bill"
                      ? "bg-emerald-600 hover:bg-emerald-700"
                      : "bg-slate-800 hover:bg-slate-900"
                  }`}
                >
                  {pending ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      {mode === "bill" ? "Billing…" : "Recording…"}
                    </>
                  ) : mode === "bill" ? (
                    <>
                      <Receipt size={14} />
                      Bill {inr(quote.total)}
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={14} />
                      Record Free Hand-out
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </Modal>
  );
}
