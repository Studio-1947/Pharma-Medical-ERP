"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Pill,
  Package,
  AlertTriangle,
  CheckCircle2,
  Receipt,
  Gift,
  IndianRupee,
  Camera,
  FileCheck,
  ShieldCheck,
  Search,
  Plus,
  X,
  ArrowLeft,
  ShoppingCart,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { apiClient, queryKeys } from "@/lib/api-client";
import { useActiveBranchId } from "@/hooks/use-branch";
import { useDebounce } from "@/hooks/use-debounce";
import { usePermissions } from "@/hooks/use-permissions";
import { formatStockUnit, getUnitLabel } from "@/lib/stock-unit-formatter";
import { quoteOtcSaleLines } from "@/lib/otc-quote";
import { scheduleLabel } from "@/lib/schedule-class";
import { useAuthStore } from "@/stores/auth.store";
import { RxPickerModal } from "./rx-picker-modal";
import { InvoiceDetailModal } from "./invoice-detail-modal";

/**
 * OTC counter supply — medicines handed over without a prescription.
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
 *
 * A walk-in rarely buys one thing, so the sale is laid out the way the counter
 * actually works it: search on the left, the growing bill on the right, both in
 * one viewport. Everything on the right goes out as a single invoice — one
 * bill, one payment, one invoice number.
 *
 * Rendered inline on the counter desk (`variant="inline"`) and inside the POS
 * terminal's dialog (`variant="modal"`, via OtcSupplyModal), so there is one
 * implementation of the sale and two places it can appear.
 */

export type OtcMedicine = {
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

/** One medicine on the counter sale, with how much of it is going out. */
type OtcLine = {
  medicine: OtcMedicine;
  saleUnit: "pack" | "loose";
  quantity: number;
  discountPct: number;
  /** Free hand-outs come off one named batch; a billed sale is FEFO'd server-side. */
  batchId: string;
};

function inr(n: number) {
  return `₹${n.toFixed(2)}`;
}

function newLine(medicine: OtcMedicine): OtcLine {
  return { medicine, saleUnit: "pack", quantity: 1, discountPct: 0, batchId: "" };
}

function asArray(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.data?.data)) return raw.data.data;
  if (Array.isArray(raw?.data)) return raw.data;
  return [];
}

export function OtcCounterSale({
  medicine,
  onClose,
  variant = "inline",
}: {
  medicine: OtcMedicine | null;
  onClose: () => void;
  /** "inline" draws its own header; inside a dialog the Modal supplies one. */
  variant?: "inline" | "modal";
}) {
  const qc = useQueryClient();
  const { branchId: activeBranchId } = useActiveBranchId();
  const { success: toastSuccess, error: toastError } = useToast();
  const { can, role } = usePermissions();
  const currentUserId = useAuthStore((st) => st.user?.id ?? null);

  const canBill = can("billing.create");
  const canGiveFree = can("inventory.adjust");

  const [lines, setLines] = useState<OtcLine[]>([]);
  const [mode, setMode] = useState<"bill" | "free">("bill");
  const [paymentMode, setPaymentMode] = useState<"cash" | "upi" | "card">("cash");
  const [referenceNo, setReferenceNo] = useState("");
  const [notes, setNotes] = useState("");
  const [billedInvoiceId, setBilledInvoiceId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Schedule H at the counter: either a prescription is attached now, or a
  // manager vouches for one and the bill carries the debt until it arrives.
  // The invoice carries one prescription, so this is a bill-level decision.
  const [prescriptionId, setPrescriptionId] = useState<string | null>(null);
  const [rxLabel, setRxLabel] = useState<string | null>(null);
  const [attested, setAttested] = useState(false);
  const [rxPickerOpen, setRxPickerOpen] = useState(false);

  const open = !!medicine;

  // The host keeps this component mounted between sales, so without this the
  // next medicine opens carrying the last sale's lines, discount and note.
  useEffect(() => {
    setLines(medicine ? [newLine(medicine)] : []);
    setReferenceNo("");
    setNotes("");
    setSearch("");
    setBilledInvoiceId(null);
    setPrescriptionId(null);
    setRxLabel(null);
    setAttested(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [medicine?.id]);

  // One batch query per line — the price, the FEFO preview and the ceiling on
  // the quantity all come from the branch's own shelves.
  const batchQueries = useQueries({
    queries: lines.map((l) => ({
      queryKey: ["otc-supply-batches", l.medicine.id, activeBranchId],
      queryFn: () =>
        apiClient.get(`/inventory/medicines/${l.medicine.id}/batches`, {
          params: { branchId: activeBranchId },
        }) as any,
      enabled: open,
    })),
  });

  /**
   * Everything the UI and the payload need per line, derived from the line's
   * own batches. Plain arithmetic over a handful of rows — cheap enough to run
   * on each keystroke, and memoising it would only fight React Query's fresh
   * array identities.
   */
  const rows = lines.map((line, idx) => {
    const q = batchQueries[idx];
    const batches = asArray(q?.data);
    const stripSize = Math.max(1, Number(line.medicine.stripSize ?? 1) || 1);
    const taxPct = Number(line.medicine.taxPercent ?? 0) || 0;
    // Shape the unit formatters expect — stripSize arrives as a numeric string
    // from the API and would otherwise be compared as text.
    const unitInfo = {
      unit: line.medicine.unit ?? null,
      dosageForm: line.medicine.dosageForm ?? null,
      stripSize,
    };
    const schedule = scheduleLabel(line.medicine.scheduleClass);
    const controlled = !!line.medicine.requiresPrescription || !!schedule;
    // Total sellable across every FEFO batch — the server allocates across
    // batches, so the ceiling is the pooled quantity, not one batch's.
    const totalAvailable = batches.reduce(
      (sum, b) => sum + Math.max(0, Number(b.quantity ?? 0) - Number(b.reservedQty ?? 0)),
      0,
    );
    // Quantity in the unit the invoice API speaks. Mirrors the POS exactly: a
    // pack line is sent as packs x stripSize, because the server prices per
    // loose unit (mrpAtEntry / stripSize).
    const baseUnits = line.saleUnit === "pack" ? line.quantity * stripSize : line.quantity;
    const maxQty =
      line.saleUnit === "pack" ? Math.floor(totalAvailable / stripSize) : totalAvailable;
    const selectedBatch = batches.find((b) => b.id === line.batchId) ?? batches[0] ?? null;
    const freeMax = Number(selectedBatch?.quantity ?? 0);

    return {
      line,
      idx,
      batches,
      loading: !!q?.isLoading,
      stripSize,
      taxPct,
      unitInfo,
      schedule,
      controlled,
      totalAvailable,
      baseUnits,
      maxQty,
      selectedBatch,
      freeMax,
    };
  });

  /**
   * Priced against the batches FEFO will actually pull from, line by line,
   * with the server's per-line rounding — so the amount tendered here is the
   * amount the server computes. A paisa of drift is not cosmetic: the invoice
   * route rejects both over-payment and an under-paid walk-in.
   */
  const quote = quoteOtcSaleLines(
    rows.map((r) => ({
      batches: r.batches,
      units: r.baseUnits,
      discountPct: r.line.discountPct,
      taxPct: r.taxPct,
      stripSize: r.stripSize,
    })),
  );

  const anyControlled = rows.some((r) => r.controlled);
  const scheduleNames = Array.from(
    new Set(rows.filter((r) => r.controlled).map((r) => r.schedule ?? "Prescription")),
  );
  const scheduleWord = scheduleNames.join(" / ") || "Prescription";
  // Vouching puts a named person on the sale, so it is a manager's call. The
  // same three roles the server accepts as an override approver — anyone else
  // would be rejected at checkout, so do not offer them the button.
  const canAttest = ["super_admin", "admin", "shop_manager"].includes(String(role));
  const rxCleared = !anyControlled || !!prescriptionId || attested;
  const loadingBatches = rows.some((r) => r.loading);
  // One rate on the bill reads better as "GST @ 12%"; a mixed bill cannot claim
  // a single rate, so it just says GST.
  const singleTaxPct =
    rows.length > 0 && rows.every((r) => r.taxPct === rows[0]!.taxPct) ? rows[0]!.taxPct : null;

  const updateLine = (idx: number, patch: Partial<OtcLine>) =>
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const removeLine = (idx: number) =>
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));

  // ── Left pane: find another medicine for the same bill ────────────────────
  const debouncedSearch = useDebounce(search, 300);
  const searchActive = open && debouncedSearch.trim().length >= 2;
  const { data: searchRaw, isFetching: searching } = useQuery({
    queryKey: ["otc-add-medicine-search", debouncedSearch, activeBranchId],
    queryFn: () =>
      apiClient.get("/inventory/medicines", {
        params: { search: debouncedSearch.trim(), limit: 8 },
      }) as any,
    enabled: searchActive,
  });
  const onBill = new Set(lines.map((l) => l.medicine.id));
  const searchResults: OtcMedicine[] = asArray(searchRaw).filter((m: any) => !onBill.has(m.id));

  const addMedicine = (m: OtcMedicine) => {
    setLines((prev) => (prev.some((l) => l.medicine.id === m.id) ? prev : [...prev, newLine(m)]));
    setSearch("");
  };

  const resetAndClose = () => {
    setBilledInvoiceId(null);
    setLines([]);
    setReferenceNo("");
    setNotes("");
    setSearch("");
    onClose();
  };

  // ── Billed OTC sale — the normal invoice route ────────────────────────────
  const billMutation = useMutation({
    mutationFn: () =>
      apiClient.post("/billing/invoices", {
        branchId: activeBranchId,
        items: rows.map((r) => ({
          medicineId: r.line.medicine.id,
          quantity: r.baseUnits,
          discountPct: r.line.discountPct.toFixed(2),
        })),
        payments: [
          {
            mode: paymentMode,
            amount: quote.total.toFixed(2),
            ...(referenceNo.trim() ? { referenceNo: referenceNo.trim() } : {}),
          },
        ],
        discountAmount: "0",
        ...(prescriptionId ? { prescriptionId } : {}),
        // Attested sale: the manager's name and reason ride on the existing
        // override fields, and rxPending is what keeps the missing paper
        // visible until someone attaches it.
        ...(attested && !prescriptionId
          ? {
              rxPending: true,
              overriddenBy: currentUserId ?? undefined,
              overrideReason: [
                "Manager verified the prescription at the counter; prescription to be attached",
                notes.trim(),
              ]
                .filter(Boolean)
                .join(" · "),
            }
          : {}),
        notes: [
          prescriptionId
            ? "OTC counter sale — prescription attached"
            : attested
              ? "OTC counter sale — prescription attested, still to be attached"
              : "OTC counter sale — no prescription",
          notes.trim(),
        ]
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
        `${invoice?.invoiceNo ? `Bill ${invoice.invoiceNo}` : "Bill created"} — ${lines.length} medicine${lines.length === 1 ? "" : "s"}, ${inr(quote.total)} received by ${paymentMode.toUpperCase()}.`,
      );
      // The bill itself is the useful thing to look at next — the counter
      // prints or shares it straight from here.
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
  // One call per medicine, because the ledger records a hand-out against a
  // named batch. Sequential and reported line by line: a hand-out that fails
  // half way through must not be reported as if all of it went out.
  const freeMutation = useMutation({
    mutationFn: async () => {
      const done: string[] = [];
      const failed: string[] = [];
      for (const r of rows) {
        const batchId = r.line.batchId || r.selectedBatch?.id;
        if (!batchId) {
          failed.push(r.line.medicine.name);
          continue;
        }
        try {
          await apiClient.post(`/inventory/batches/${batchId}/otc-supply`, {
            quantity: r.line.quantity,
            branchId: activeBranchId,
            notes: notes.trim() || undefined,
          });
          done.push(r.line.medicine.name);
        } catch {
          failed.push(r.line.medicine.name);
        }
      }
      return { done, failed };
    },
    onSuccess: ({ done, failed }) => {
      qc.invalidateQueries({ queryKey: ["otc-supply-batches"] });
      qc.invalidateQueries({ queryKey: ["counter-low-stock"] });
      qc.invalidateQueries({ queryKey: ["counter-otc-today"] });
      qc.invalidateQueries({ queryKey: ["medicine-batches-detail"] });
      qc.invalidateQueries({ queryKey: queryKeys.medicines.list({}) });
      if (done.length > 0) {
        toastSuccess(
          "Free hand-out recorded",
          `${done.join(", ")} given free — stock deducted, no bill.`,
        );
      }
      if (failed.length > 0) {
        toastError(
          "Some hand-outs were not recorded",
          `${failed.join(", ")} could not be handed out. Their stock is unchanged — try again.`,
        );
        return;
      }
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
    if (rows.length === 0) return;
    if (mode === "free") {
      if (anyControlled) return;
      if (rows.some((r) => !r.line.batchId && !r.selectedBatch)) return;
      freeMutation.mutate();
      return;
    }
    if (quote.short > 0 || quote.total <= 0) return;
    if (!rxCleared) return;
    billMutation.mutate();
  };

  const pending = billMutation.isPending || freeMutation.isPending;
  const freeBlocked =
    anyControlled ||
    !canGiveFree ||
    rows.length === 0 ||
    rows.some((r) => r.freeMax <= 0 || r.line.quantity > r.freeMax);

  // After a successful sale the bill itself is the useful thing to look at —
  // the counter prints or shares it from here.
  if (billedInvoiceId) {
    return <InvoiceDetailModal invoiceId={billedInvoiceId} onClose={resetAndClose} />;
  }

  // The picker searches verified prescriptions and, on its upload tab,
  // photographs a paper one and files it against a walk-in patient before
  // returning the id — the whole "scan it now" path already existed for the POS.
  if (rxPickerOpen && medicine) {
    return (
      <RxPickerModal
        open
        onClose={() => setRxPickerOpen(false)}
        onSelectRx={(rxId, details) => {
          setPrescriptionId(rxId);
          setRxLabel(details?.doctorName ? `from ${details.doctorName}` : null);
          setAttested(false);
          setRxPickerOpen(false);
        }}
      />
    );
  }

  if (!medicine) return null;

  const heading =
    mode === "free"
      ? "Free hand-out — no bill"
      : anyControlled
        ? `${scheduleWord} sale — prescription required`
        : "OTC sale — no prescription";

  return (
    <div className="space-y-4">
      {variant === "inline" && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-9 h-9 rounded-xl bg-orange-100 text-orange-700 flex items-center justify-center shrink-0">
              <Pill size={16} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-800 truncate">{heading}</p>
              <p className="text-xs text-slate-400 truncate">
                Search on the left, bill on the right — add as many medicines as
                the customer is taking.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-slate-200 bg-white text-slate-600 text-xs font-semibold hover:bg-slate-50 transition-colors"
          >
            <ArrowLeft size={13} /> Back to search
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* ══ LEFT — find the medicines ═══════════════════════════════════ */}
        <div className="lg:col-span-5 space-y-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-3.5 space-y-3">
            <label
              htmlFor="otc-add-medicine"
              className="block text-xs font-bold text-slate-700"
            >
              Search medicines
            </label>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                id="otc-add-medicine"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  // Enter inside the sale form would otherwise submit the bill.
                  // On this field it means "take the first match", which is also
                  // what a barcode scanner's trailing Enter should do.
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  const first = searchResults[0];
                  if (first) addMedicine(first);
                }}
                placeholder="Name, SKU or barcode…"
                type="search"
                autoComplete="off"
                className="w-full text-sm border-2 border-slate-200 rounded-xl pl-9 pr-3 py-2.5 bg-white focus:outline-none focus:border-orange-400 focus:ring-4 focus:ring-orange-100 transition-all [&::-webkit-search-cancel-button]:appearance-none"
              />
            </div>

            <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden max-h-[420px] overflow-y-auto">
              {!searchActive && (
                <p className="px-3 py-6 text-center text-xs text-slate-400">
                  Type at least 2 characters to find a medicine, or scan its
                  barcode.
                </p>
              )}
              {searchActive && searching && (
                <p className="px-3 py-2.5 text-xs text-slate-400 animate-pulse">Searching…</p>
              )}
              {searchActive && !searching && searchResults.length === 0 && (
                <p className="px-3 py-6 text-center text-xs text-slate-400">
                  Nothing else matched &ldquo;{debouncedSearch.trim()}&rdquo;.
                </p>
              )}
              {searchActive &&
                searchResults.map((m: any) => {
                  const stock = Number(m.totalStock || 0);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => addMedicine(m)}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-orange-50/60 transition-colors"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-bold text-slate-800 truncate">
                          {m.name}
                        </span>
                        <span className="block text-[11px] text-slate-400 font-mono truncate">
                          {m.sku ?? ""}
                          {m.scheduleClass ? ` · ${m.scheduleClass}` : ""}
                        </span>
                      </span>
                      {/* Stock keeps its own column so the add buttons line up
                          down the list instead of shuffling with the length of
                          "Out of stock". */}
                      <span
                        className={`w-20 shrink-0 text-right text-[11px] font-semibold leading-tight ${
                          stock > 0 ? "text-emerald-700" : "text-rose-600"
                        }`}
                      >
                        {formatStockUnit(stock, m)}
                      </span>
                      <span className="w-16 shrink-0 inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-full bg-orange-500 text-white text-[11px] font-bold">
                        <Plus size={11} /> Add
                      </span>
                    </button>
                  );
                })}
            </div>
          </div>
        </div>

        {/* ══ RIGHT — the bill being built ════════════════════════════════ */}
        <div className="lg:col-span-7 space-y-3">
          {/* Mode switch */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!canBill}
              onClick={() => setMode("bill")}
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
                // A quantity typed in packs would otherwise walk off one batch
                // as if it were that many loose units.
                setLines((prev) =>
                  prev.map((l, i) => ({
                    ...l,
                    saleUnit: "pack",
                    quantity: Math.max(1, Math.min(l.quantity, rows[i]?.freeMax || 1)),
                  })),
                );
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

          {/* Schedule H at the counter. This used to be a dead end — "bill it
              from the POS" — which just moved the problem to another screen and
              taught staff that the OTC desk lies. There are only two honest
              ways past it: produce the prescription, or have a manager put
              their name to having seen it and owe the paper afterwards. */}
          {/* A free hand-out writes no invoice, so there is nothing to attach a
              prescription to and no rxPending flag to carry the debt — the drug
              would simply leave the shelf with a ledger line and no authority
              behind it. Giving a Schedule H medicine away is not a lesser act
              than selling one, so this path is closed for them outright. */}
          {anyControlled && mode === "free" && (
            <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>
                {scheduleWord} cannot be given away as a free hand-out — there
                would be no bill and no prescription on record. Use{" "}
                <strong>Bill it</strong> and either attach the prescription or
                have a manager vouch for it.
              </span>
            </div>
          )}

          {anyControlled && mode === "bill" && (
            <div
              className={`rounded-xl border px-3 py-2.5 space-y-2.5 ${
                rxCleared ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"
              }`}
            >
              {prescriptionId ? (
                <div className="flex items-start gap-2 text-xs text-emerald-800">
                  <FileCheck size={14} className="shrink-0 mt-0.5" />
                  <span>
                    Prescription <strong>{rxLabel ?? "linked"}</strong> is
                    attached to this sale.{" "}
                    <button
                      type="button"
                      onClick={() => {
                        setPrescriptionId(null);
                        setRxLabel(null);
                      }}
                      className="underline font-semibold"
                    >
                      Change
                    </button>
                  </span>
                </div>
              ) : attested ? (
                <div className="flex items-start gap-2 text-xs text-emerald-800">
                  <FileCheck size={14} className="shrink-0 mt-0.5" />
                  <span>
                    You are billing this on your own word that you have seen the
                    prescription. The bill will be flagged as still owing it
                    until someone attaches the prescription.{" "}
                    <button
                      type="button"
                      onClick={() => setAttested(false)}
                      className="underline font-semibold"
                    >
                      Undo
                    </button>
                  </span>
                </div>
              ) : (
                <>
                  <div className="flex items-start gap-2 text-xs text-red-700">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    <span>
                      {scheduleWord} cannot be handed over without a
                      prescription. Attach it, or vouch for it and attach it
                      later.
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setRxPickerOpen(true)}
                      className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors"
                    >
                      <Camera size={14} /> Scan / attach prescription
                    </button>
                    <button
                      type="button"
                      disabled={!canAttest}
                      onClick={() => setAttested(true)}
                      title={
                        canAttest
                          ? "Bill now on your verification, attach the prescription afterwards"
                          : "Only a shop manager or admin can vouch for a prescription"
                      }
                      className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <ShieldCheck size={14} /> I verified it — attach later
                    </button>
                  </div>
                  {!canAttest && (
                    <p className="text-[11px] text-slate-500">
                      Vouching is a manager&apos;s call — your name goes on the
                      sale. Ask a shop manager to sign in, or scan the
                      prescription.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Lines on this sale */}
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-3.5 py-2 border-b border-slate-100 bg-slate-50/70 flex items-center justify-between gap-2">
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <ShoppingCart size={12} /> On this{" "}
                {mode === "free" ? "hand-out" : "bill"}
              </p>
              <span className="text-[10px] font-bold text-slate-400">
                {lines.length} medicine{lines.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="p-3 space-y-3 max-h-[460px] overflow-y-auto">
              {rows.length === 0 && (
                <p className="py-6 text-center text-xs text-slate-400">
                  Nothing added yet — search on the left.
                </p>
              )}
              {rows.map((r) => {
                const unitLabel = getUnitLabel(r.line.quantity, r.unitInfo);
                const lineQuote = quote.lines[r.idx];
                const outOfStock = !r.loading && r.totalAvailable <= 0;

                return (
                  <div
                    key={r.line.medicine.id}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-3 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">
                          {r.line.medicine.name}
                        </p>
                        <p className="text-[11px] text-slate-400 font-mono truncate">
                          {r.line.medicine.sku ?? ""}
                          {r.schedule ? ` · ${r.schedule}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm font-black text-slate-900">
                          {mode === "bill" ? inr(lineQuote?.total ?? 0) : "No charge"}
                        </span>
                        {lines.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeLine(r.idx)}
                            title={`Remove ${r.line.medicine.name} from this sale`}
                            aria-label={`Remove ${r.line.medicine.name}`}
                            className="w-6 h-6 rounded-full border border-slate-200 text-slate-400 hover:text-rose-600 hover:border-rose-200 flex items-center justify-center transition-colors"
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>
                    </div>

                    {r.loading ? (
                      <p className="text-xs text-slate-400 animate-pulse">Loading active batches…</p>
                    ) : outOfStock ? (
                      <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-2">
                        <Package size={13} className="shrink-0 mt-0.5" />
                        <span>
                          No active stock in this branch. Receive stock for this
                          medicine, or remove it from the sale.
                        </span>
                      </div>
                    ) : mode === "free" ? (
                      /* Batch picker — a free hand-out comes off one named batch */
                      <div>
                        <label
                          htmlFor={`otc-batch-${r.line.medicine.id}`}
                          className="block text-xs font-bold text-slate-700 mb-1.5"
                        >
                          Batch (FEFO order — earliest expiry first)
                        </label>
                        <select
                          id={`otc-batch-${r.line.medicine.id}`}
                          value={r.line.batchId || r.selectedBatch?.id || ""}
                          onChange={(e) => updateLine(r.idx, { batchId: e.target.value })}
                          required
                          className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/30"
                        >
                          {r.batches.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.batchNo} — {formatStockUnit(Number(b.quantity ?? 0), r.unitInfo)}
                              {b.expiryDate ? ` · exp ${b.expiryDate.slice(0, 7)}` : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      /* Billed sale: the server picks batches by FEFO, splitting
                         across them when one runs short — show what it will pull. */
                      <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                          Batches used (FEFO — earliest expiry first)
                        </p>
                        {!lineQuote || lineQuote.used.length === 0 ? (
                          <p className="text-xs text-slate-500 mt-1">
                            Enter a quantity to see which batch is pulled.
                          </p>
                        ) : (
                          <ul className="mt-1 space-y-0.5">
                            {lineQuote.used.map((u) => (
                              <li key={u.batchNo} className="text-xs text-slate-700 font-medium">
                                {u.batchNo} — {u.units} unit{u.units === 1 ? "" : "s"}
                                {u.expiryDate ? ` · exp ${u.expiryDate.slice(0, 7)}` : ""}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}

                    {!r.loading && !outOfStock && (
                      <>
                        {/* Sale unit — only meaningful when a pack holds more than one */}
                        {mode === "bill" && r.stripSize > 1 && (
                          <div>
                            <p
                              id={`otc-saleunit-label-${r.line.medicine.id}`}
                              className="block text-xs font-bold text-slate-700 mb-1.5"
                            >
                              Sold as
                            </p>
                            <div
                              className="grid grid-cols-2 gap-2"
                              role="group"
                              aria-labelledby={`otc-saleunit-label-${r.line.medicine.id}`}
                            >
                              {(["pack", "loose"] as const).map((u) => (
                                <button
                                  key={u}
                                  type="button"
                                  onClick={() => {
                                    // A quantity typed in loose units would
                                    // otherwise become that many full packs.
                                    const cap =
                                      u === "pack"
                                        ? Math.floor(r.totalAvailable / r.stripSize)
                                        : r.totalAvailable;
                                    updateLine(r.idx, {
                                      saleUnit: u,
                                      quantity: Math.max(1, Math.min(r.line.quantity, cap || 1)),
                                    });
                                  }}
                                  className={`px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${
                                    r.line.saleUnit === u
                                      ? "bg-slate-800 text-white border-slate-800"
                                      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                                  }`}
                                >
                                  {u === "pack"
                                    ? `Full ${getUnitLabel(1, r.unitInfo)} (${r.stripSize})`
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
                              htmlFor={`otc-quantity-${r.line.medicine.id}`}
                              className="block text-xs font-bold text-slate-700 mb-1.5"
                            >
                              Quantity {mode === "bill" ? `(${unitLabel})` : "to supply"}
                            </label>
                            <input
                              id={`otc-quantity-${r.line.medicine.id}`}
                              type="number"
                              min={1}
                              max={(mode === "free" ? r.freeMax : r.maxQty) || undefined}
                              value={r.line.quantity}
                              onChange={(e) => {
                                const cap = mode === "free" ? r.freeMax : r.maxQty;
                                updateLine(r.idx, {
                                  quantity: Math.min(
                                    cap || 1,
                                    Math.max(1, Number(e.target.value) || 1),
                                  ),
                                });
                              }}
                              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/30"
                            />
                            <p className="mt-1 text-[11px] text-slate-400">
                              Max {mode === "free" ? r.freeMax : r.maxQty} on{" "}
                              {mode === "free" ? "this batch" : "hand"}
                            </p>
                          </div>

                          {mode === "bill" && (
                            <div>
                              <label
                                htmlFor={`otc-discount-${r.line.medicine.id}`}
                                className="block text-xs font-bold text-slate-700 mb-1.5"
                              >
                                Discount %
                              </label>
                              <input
                                id={`otc-discount-${r.line.medicine.id}`}
                                type="number"
                                min={0}
                                max={100}
                                step="0.01"
                                value={r.line.discountPct}
                                onChange={(e) =>
                                  updateLine(r.idx, {
                                    discountPct: Math.min(
                                      100,
                                      Math.max(0, Number(e.target.value) || 0),
                                    ),
                                  })
                                }
                                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-orange-500/30"
                              />
                              <p className="mt-1 text-[11px] text-slate-400">
                                Comes off before GST is worked out
                              </p>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {mode === "bill" && (
            <>
              {/* Payment */}
              <div>
                <p id="otc-payment-label" className="block text-xs font-bold text-slate-700 mb-1.5">
                  Payment received by
                </p>
                <div
                  className="grid grid-cols-3 gap-2"
                  role="group"
                  aria-labelledby="otc-payment-label"
                >
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
                    Reference no <span className="font-normal text-slate-400">(optional)</span>
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
                  <span>
                    Taxable value
                    {rows.some((r) => r.line.discountPct > 0) ? " (after discount)" : ""}
                  </span>
                  <span className="font-semibold">{inr(quote.subtotal)}</span>
                </div>
                <div className="flex justify-between text-xs text-slate-600">
                  <span>GST{singleTaxPct !== null ? ` @ ${singleTaxPct}%` : ""}</span>
                  <span className="font-semibold">{inr(quote.tax)}</span>
                </div>
                <div className="flex justify-between text-sm font-extrabold text-emerald-800 pt-1 border-t border-emerald-200">
                  <span className="flex items-center gap-1">
                    <IndianRupee size={13} /> To collect
                    {lines.length > 1 ? ` (${lines.length} medicines)` : ""}
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
            <label htmlFor="otc-notes" className="block text-xs font-bold text-slate-700 mb-1.5">
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
                loadingBatches ||
                (mode === "bill"
                  ? !rxCleared || !canBill || quote.short > 0 || quote.total <= 0
                  : freeBlocked)
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
        </div>
      </form>
    </div>
  );
}
