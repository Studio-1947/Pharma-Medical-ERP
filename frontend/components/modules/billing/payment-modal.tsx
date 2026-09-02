"use client";

import { useState, useEffect, useMemo } from "react";
import { X, Banknote, Smartphone, CreditCard, Shield, FileText, Layers, Plus, Trash2 } from "lucide-react";

const MODE_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  cash:      { label: "Cash",      icon: <Banknote size={16} />,    color: "emerald" },
  upi:       { label: "UPI",       icon: <Smartphone size={16} />,  color: "violet" },
  card:      { label: "Card",      icon: <CreditCard size={16} />,  color: "blue" },
  insurance: { label: "Insurance", icon: <Shield size={16} />,      color: "amber" },
  credit:    { label: "Credit",    icon: <FileText size={16} />,    color: "rose" },
  mixed:     { label: "Mixed",     icon: <Layers size={16} />,      color: "slate" },
};

const MODES = ["cash", "upi", "card", "insurance", "credit"] as const;
const QUICK_AMOUNTS = [20, 50, 100, 200, 500, 1000];

interface Props {
  open: boolean;
  total: number;
  /** True when a patient is selected — required to accept a partial payment.
   *  Walk-ins have no account to owe against, so the modal keeps them locked
   *  to a balanced total. */
  hasPatient?: boolean;
  onConfirm: (mode: string, splits: { mode: string; amount: number; ref?: string }[]) => void;
  onClose: () => void;
  loading?: boolean;
  needsRx?: boolean;
  prescriptionId?: string | null;
  onOpenRxPicker?: () => void;
  /** Preselect the tender chosen on the calling screen. */
  initialMode?: "cash" | "upi" | "card";
}

export function PaymentModal({ open, total, hasPatient, onConfirm, onClose, loading, needsRx, prescriptionId, onOpenRxPicker, initialMode = "cash" }: Props) {
  const [mode, setMode] = useState<string>("cash");
  const [splits, setSplits] = useState<{ mode: string; amount: string; ref: string }[]>([
    { mode: "cash", amount: "", ref: "" },
  ]);
  const [cashTendered, setCashTendered] = useState<string>("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setSplits([{ mode: initialMode, amount: String(total.toFixed(2)), ref: "" }]);
      setCashTendered(String(total.toFixed(2)));
      setError("");
    }
  }, [open, total, initialMode]);

  // Lock body scroll while open
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  // Close modal on Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const isMulti = mode === "mixed";
  const addSplit = () => setSplits((s) => [...s, { mode: "cash", amount: "", ref: "" }]);
  const removeSplit = (i: number) => setSplits((s) => s.filter((_, idx) => idx !== i));
  const updateSplit = (i: number, field: string, val: string) =>
    setSplits((s) => s.map((r, idx) => (idx === i ? { ...r, [field]: val } : r)));

  const totalAllocated = splits.reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0);
  const cashIn = parseFloat(cashTendered) || 0;
  const changeDue = Math.max(0, cashIn - total);
  const splitGap = total - totalAllocated;

  /** How far the cash on the counter falls short of the bill. */
  const cashShort = Math.max(0, total - cashIn);

  /**
   * Notes a customer plausibly hands over: the next round figures above the
   * bill. The fixed 100/200/500/1000 buttons this replaces sat *below* most
   * bill totals, so tapping one under-paid the bill and then showed a change
   * of zero with no explanation, which is what made this panel unusable.
   */
  const cashSuggestions = useMemo(() => {
    const out: number[] = [];
    for (const step of [10, 50, 100, 500, 1000]) {
      const up = Math.ceil(total / step) * step;
      if (up > total + 0.001 && !out.includes(up)) out.push(up);
    }
    return out.slice(0, 3);
  }, [total]);

  const handleModeSwitch = (m: string) => {
    setMode(m);
    setError("");
    if (m === "mixed") {
      setSplits([
        { mode: "cash", amount: String((total / 2).toFixed(2)), ref: "" },
        { mode: "upi",  amount: String((total / 2).toFixed(2)), ref: "" },
      ]);
    } else {
      setSplits([{ mode: m, amount: String(total.toFixed(2)), ref: "" }]);
      setCashTendered(String(total.toFixed(2)));
    }
  };

  // Under-payment is a legitimate outstanding-balance outcome. The
  // over-payment case stays a hard block — a refund is a separate return flow,
  // not an invoice with a negative balance.
  const splitOver = splitGap < -0.01;
  const splitDue = splitGap > 0.01;
  const allowWalkInBalance = true;
  const acceptedAsDue = isMulti && splitDue;

  const handleConfirm = () => {
    setError("");
    if (isMulti) {
      if (splitOver) {
        setError(`Split total ₹${totalAllocated.toFixed(2)} exceeds ₹${total.toFixed(2)}. Over-collection is a return, not a sale.`);
        return;
      }
      if (splitDue && !hasPatient && !allowWalkInBalance) {
        setError(`Walk-in sales must be paid in full — register a patient to accept ₹${splitGap.toFixed(2)} as due.`);
        return;
      }
      onConfirm("mixed", splits.map((s) => ({ mode: s.mode, amount: parseFloat(s.amount) || 0, ref: s.ref })));
    } else {
      onConfirm(mode, [{ mode, amount: total, ref: splits[0]?.ref }]);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-md sm:mx-4 max-h-[94dvh] overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b">
          <h2 className="text-lg font-bold text-gray-900">Collect Payment</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-4 sm:px-6 py-4 space-y-3.5">

          {/* Amount due */}
          <div className="bg-slate-50 rounded-xl px-4 py-2.5 text-center border border-slate-200">
            {/* Not "Amount Due": in this app a due is money still owed after
                the sale, so that wording on the bill total read to counter
                staff as if the customer already owed it. */}
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-0.5">Amount to Collect</p>
            <p className="text-3xl font-black text-slate-900">₹{total.toFixed(2)}</p>
          </div>

          {/* Schedule H Prescription Warning Block inside Modal */}
          {needsRx && (
            <div className={`p-3.5 rounded-xl border flex flex-col gap-2.5 ${prescriptionId?.trim() ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
                  <FileText size={15} className={prescriptionId?.trim() ? "text-emerald-600" : "text-amber-600"} />
                  <span className={prescriptionId?.trim() ? "text-emerald-800" : "text-amber-800"}>
                    {prescriptionId?.trim() ? "Verified Rx Linked" : "Prescription Required (Schedule H)"}
                  </span>
                </div>
                {onOpenRxPicker && (
                  <button
                    type="button"
                    onClick={onOpenRxPicker}
                    className="px-2.5 py-1 rounded-lg text-xs font-bold bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 shadow-2xs transition-colors shrink-0"
                  >
                    {prescriptionId?.trim() ? "Change Rx" : "Select Verified Rx"}
                  </button>
                )}
              </div>
              {prescriptionId?.trim() ? (
                <p className="text-xs font-medium text-emerald-700 font-mono truncate">
                  Rx ID: #{prescriptionId}
                </p>
              ) : (
                <p className="text-xs text-amber-700 font-medium">
                  This checkout contains Schedule H medicines. Click &quot;Select Verified Rx&quot; above to select or link a prescription.
                </p>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-xs px-3 py-2 rounded-lg font-medium">
              {error}
            </div>
          )}

          {/* Payment mode grid */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2.5">Payment Mode</p>
            <div className="grid grid-cols-3 gap-2">
              {([...MODES, "mixed"] as string[]).map((m) => {
                const meta = MODE_META[m]!;
                const active = mode === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => handleModeSwitch(m)}
                    className={`flex flex-col items-center gap-1 py-2.5 px-2 rounded-xl border-2 text-xs font-semibold transition-all duration-150 ${
                      active
                        ? "border-slate-800 bg-slate-800 text-white shadow-md shadow-slate-800/30"
                        : "border-gray-200 bg-gray-50 text-gray-600 hover:border-slate-400 hover:bg-slate-50 hover:text-slate-800"
                    }`}
                  >
                    {meta.icon}
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Mode-specific section */}
          {isMulti ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Split Breakdown</p>
              <div className="space-y-2 bg-gray-50 rounded-xl p-3 border">
                {splits.map((s, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <select
                      value={s.mode}
                      onChange={(e) => updateSplit(i, "mode", e.target.value)}
                      className="border rounded-lg px-2 py-2 text-xs flex-1 bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
                    >
                      {MODES.map((m) => (
                        <option key={m} value={m}>{MODE_META[m]!.label}</option>
                      ))}
                    </select>
                    <div className="relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-medium">₹</span>
                      <input
                        value={s.amount}
                        onChange={(e) => updateSplit(i, "amount", e.target.value)}
                        type="number"
                        step="0.01"
                        className="border rounded-lg pl-6 pr-2 py-2 text-xs w-24 bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 text-right font-semibold"
                      />
                    </div>
                    <input
                      value={s.ref}
                      onChange={(e) => updateSplit(i, "ref", e.target.value)}
                      placeholder="Ref (opt)"
                      className="border rounded-lg px-2 py-2 text-xs w-24 bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                    {splits.length > 1 && (
                      <button type="button" onClick={() => removeSplit(i)} className="text-red-400 hover:text-red-600 shrink-0">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                ))}
                <div className="flex items-center justify-between pt-1 border-t">
                  <button type="button" onClick={addSplit} className="flex items-center gap-1 text-xs text-primary font-semibold hover:underline">
                    <Plus size={12} /> Add split
                  </button>
                  <div className="text-xs font-semibold text-right">
                    {Math.abs(splitGap) < 0.01 ? (
                      <span className="text-green-600">Balanced</span>
                    ) : splitOver ? (
                      <span className="text-red-600">₹{Math.abs(splitGap).toFixed(2)} over</span>
                    ) : hasPatient ? (
                      <span className="text-purple-600">
                        ₹{splitGap.toFixed(2)} will be added to dues
                      </span>
                    ) : (
                      <span className="text-amber-600">
                        ₹{splitGap.toFixed(2)} remaining — walk-in cannot owe
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {acceptedAsDue && (
                <div className="rounded-xl border border-purple-200 bg-purple-50/70 px-3 py-2 text-[11px] text-purple-800 leading-snug">
                  Recording this sale will leave ₹{splitGap.toFixed(2)} owing on the
                  patient&apos;s account. Collect it later from their outstanding page.
                </div>
              )}
            </div>

          ) : mode === "cash" ? (
            <div className="space-y-2.5">
              {/* What the customer actually handed over */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                  How much cash did the customer give?
                </p>
                <div className="grid grid-cols-4 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCashTendered(String(total.toFixed(2)))}
                    className={`py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                      Math.abs(cashIn - total) < 0.005
                        ? "bg-emerald-500 text-white border-emerald-500"
                        : "border-gray-200 bg-gray-50 text-gray-700 hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700"
                    }`}
                  >
                    Exact
                  </button>
                  {cashSuggestions.map((amt) => (
                    <button key={amt} type="button"
                      onClick={() => setCashTendered(String(amt.toFixed(2)))}
                      className={`py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                        Math.abs(cashIn - amt) < 0.005
                          ? "bg-emerald-500 text-white border-emerald-500"
                          : "border-gray-200 bg-gray-50 text-gray-700 hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700"
                      }`}
                    >
                      ₹{amt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Cash received + change */}
              <div className="bg-gray-50 rounded-xl p-3 border space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">Cash received</span>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-medium">₹</span>
                    <input
                      value={cashTendered}
                      onChange={(e) => setCashTendered(e.target.value)}
                      type="number"
                      step="0.01"
                      className="border rounded-lg pl-7 pr-3 py-1.5 text-sm font-bold w-32 bg-white focus:outline-none focus:ring-2 focus:ring-primary/50 text-right"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between border-t pt-2">
                  {/* "Change Due" sat directly under a header reading "Amount
                      Due" and was read as more money owed -- the opposite of
                      what it means. This names which way the money moves. */}
                  <span className="text-sm font-semibold text-gray-600">Give back to customer</span>
                  <span className={`text-xl font-black ${changeDue > 0 ? "text-emerald-600" : "text-gray-400"}`}>
                    ₹{changeDue.toFixed(2)}
                  </span>
                </div>
              </div>

              {cashShort > 0.01 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-[11px] text-amber-900 leading-snug">
                  That is ₹{cashShort.toFixed(2)} less than the bill. This box only
                  works out the change &mdash; confirming still records the full
                  ₹{total.toFixed(2)} as paid. To leave the rest owing on the
                  patient&apos;s account, use <strong>Mixed</strong> instead.
                </div>
              )}
            </div>

          ) : (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {mode === "upi" ? "UPI Transaction ID" : mode === "card" ? "Card Auth / Last 4 Digits" : "Reference Number"}
              </label>
              <input
                value={splits[0]?.ref ?? ""}
                onChange={(e) => updateSplit(0, "ref", e.target.value)}
                placeholder={
                  mode === "upi" ? "e.g. UPI123456789" :
                  mode === "card" ? "e.g. XXXX 4242" :
                  "Optional reference"
                }
                className="w-full border rounded-xl px-4 py-2.5 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:bg-white transition-colors"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 pt-1">
          <button
            onClick={handleConfirm}
            disabled={loading || (needsRx && !prescriptionId?.trim())}
            title={needsRx && !prescriptionId?.trim() ? "Prescription required for Schedule H sales" : undefined}
            className="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-3.5 rounded-xl font-bold text-base transition-all duration-150 shadow-lg shadow-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Processing...
              </span>
            ) : acceptedAsDue ? (
              `Confirm — ₹${totalAllocated.toFixed(2)} now, ₹${splitGap.toFixed(2)} due`
            ) : (
              `Confirm Payment  ₹${total.toFixed(2)}`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
