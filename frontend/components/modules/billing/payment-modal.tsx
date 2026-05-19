"use client";

import { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";

const MODES = ["cash", "upi", "card", "insurance", "credit"] as const;

interface Props {
  open: boolean;
  total: number;
  onConfirm: (mode: string, splits: { mode: string; amount: number; ref?: string }[]) => void;
  onClose: () => void;
  loading?: boolean;
}

export function PaymentModal({ open, total, onConfirm, onClose, loading }: Props) {
  const [mode, setMode] = useState<string>("cash");
  const [splits, setSplits] = useState<{ mode: string; amount: string; ref: string }[]>([
    { mode: "cash", amount: "", ref: "" },
  ]);
  const [cashTendered, setCashTendered] = useState<string>("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (open) {
      setMode("cash");
      setSplits([{ mode: "cash", amount: String(total.toFixed(2)), ref: "" }]);
      setCashTendered(String(total.toFixed(2)));
      setError("");
    }
  }, [open, total]);

  const isMulti = mode === "mixed";

  const addSplit = () => setSplits((s) => [...s, { mode: "cash", amount: "", ref: "" }]);
  const updateSplit = (i: number, field: string, val: string) =>
    setSplits((s) => s.map((r, idx) => (idx === i ? { ...r, [field]: val } : r)));

  const totalAllocated = splits.reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0);

  // Change due for Cash Mode only
  const changeDue = Math.max(0, (parseFloat(cashTendered) || 0) - total);

  const handleConfirm = () => {
    setError("");
    const parsed = splits.map((s) => ({
      mode: s.mode,
      amount: parseFloat(s.amount) || 0,
      ref: s.ref,
    }));

    if (isMulti) {
      // Validate that total sum equals exactly the total invoice amount
      if (Math.abs(totalAllocated - total) > 0.01) {
        setError(`Total split amounts (₹${totalAllocated.toFixed(2)}) must exactly equal invoice total (₹${total.toFixed(2)}).`);
        return;
      }
      onConfirm("mixed", parsed);
    } else {
      onConfirm(mode, [{ mode, amount: total, ref: splits[0]?.ref }]);
    }
  };

  return (
    <Modal title="Collect Payment" open={open} onClose={onClose} size="sm">
      <div className="space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 text-xs px-3 py-2 rounded-lg font-medium">
            {error}
          </div>
        )}

        <div className="text-center">
          <p className="text-sm text-muted-foreground">Amount Due</p>
          <p className="text-3xl font-bold text-primary">₹{total.toFixed(2)}</p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-2">Payment Mode</label>
          <div className="flex flex-wrap gap-2">
            {[...MODES, "mixed"].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setError("");
                  if (m === "mixed") {
                    setSplits([
                      { mode: "cash", amount: String((total / 2).toFixed(2)), ref: "" },
                      { mode: "upi", amount: String((total / 2).toFixed(2)), ref: "" },
                    ]);
                  } else {
                    setSplits([{ mode: m, amount: String(total.toFixed(2)), ref: "" }]);
                  }
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize border transition duration-200 ${
                  mode === m ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {isMulti ? (
          <div className="space-y-2 border p-3 rounded-lg bg-muted/20">
            <p className="text-xs font-semibold text-gray-600 mb-1">Split Breakdown</p>
            {splits.map((s, i) => (
              <div key={i} className="flex gap-2 items-center">
                <select
                  value={s.mode}
                  onChange={(e) => updateSplit(i, "mode", e.target.value)}
                  className="border rounded-lg px-2 py-1.5 text-xs flex-1 bg-background"
                >
                  {MODES.map((m) => (
                    <option key={m} value={m}>
                      {m.toUpperCase()}
                    </option>
                  ))}
                </select>
                <input
                  value={s.amount}
                  onChange={(e) => updateSplit(i, "amount", e.target.value)}
                  placeholder="Amount"
                  type="number"
                  step="0.01"
                  className="border rounded-lg px-2 py-1.5 text-xs w-24 bg-background focus:outline-none"
                />
                <input
                  value={s.ref}
                  onChange={(e) => updateSplit(i, "ref", e.target.value)}
                  placeholder="Ref (Opt)"
                  className="border rounded-lg px-2 py-1.5 text-xs flex-1 bg-background focus:outline-none"
                />
              </div>
            ))}
            <div className="flex justify-between items-center text-xs font-medium pt-1">
              <button
                type="button"
                onClick={addSplit}
                className="text-primary hover:underline font-semibold"
              >
                + Add split
              </button>
              <span className={totalAllocated === total ? "text-green-600" : "text-amber-600"}>
                Sum: ₹{totalAllocated.toFixed(2)}
              </span>
            </div>
          </div>
        ) : mode === "cash" ? (
          <div className="bg-muted/30 p-3 rounded-lg space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium">Cash Received</label>
              <input
                value={cashTendered}
                onChange={(e) => setCashTendered(e.target.value)}
                placeholder="0.00"
                type="number"
                step="0.01"
                className="border rounded-lg px-2.5 py-1 text-sm font-semibold w-32 bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 text-right"
              />
            </div>
            <div className="flex items-center justify-between text-xs font-semibold text-gray-700 pt-1 border-t">
              <span>Change Due:</span>
              <span className="text-base font-bold text-green-600">₹{changeDue.toFixed(2)}</span>
            </div>
          </div>
        ) : (
          <div>
            <label className="block text-xs font-medium mb-1">Reference / Txn ID</label>
            <input
              value={splits[0]?.ref ?? ""}
              onChange={(e) => updateSplit(0, "ref", e.target.value)}
              placeholder="Optional (UPI ID, card auth code...)"
              className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
        )}

        <button
          onClick={handleConfirm}
          disabled={loading}
          className="w-full bg-green-600 text-white py-2.5 rounded-lg font-semibold text-sm hover:bg-green-700 disabled:opacity-60 transition duration-200 shadow-sm"
        >
          {loading ? "Processing..." : `Confirm Payment (₹${total.toFixed(2)})`}
        </button>
      </div>
    </Modal>
  );
}
