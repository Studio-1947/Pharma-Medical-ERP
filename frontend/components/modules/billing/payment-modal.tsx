"use client";
import { useState } from "react";
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
  const [splits, setSplits] = useState<{ mode: string; amount: string; ref: string }[]>([{ mode: "cash", amount: String(total.toFixed(2)), ref: "" }]);

  const isMulti = mode === "mixed";

  const addSplit = () => setSplits((s) => [...s, { mode: "cash", amount: "", ref: "" }]);
  const updateSplit = (i: number, field: string, val: string) =>
    setSplits((s) => s.map((r, idx) => (idx === i ? { ...r, [field]: val } : r)));

  const handleConfirm = () => {
    const parsed = splits.map((s) => ({ mode: s.mode, amount: parseFloat(s.amount) || 0, ref: s.ref }));
    onConfirm(isMulti ? "mixed" : mode, isMulti ? parsed : [{ mode, amount: total, ref: splits[0]?.ref }]);
  };

  return (
    <Modal title="Collect Payment" open={open} onClose={onClose} size="sm">
      <div className="space-y-4">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">Amount Due</p>
          <p className="text-3xl font-bold">₹{total.toFixed(2)}</p>
        </div>

        <div>
          <label className="block text-xs font-medium mb-2">Payment Mode</label>
          <div className="flex flex-wrap gap-2">
            {[...MODES, "mixed"].map((m) => (
              <button key={m} onClick={() => setMode(m)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize border transition-colors ${mode === m ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}>
                {m}
              </button>
            ))}
          </div>
        </div>

        {isMulti ? (
          <div className="space-y-2">
            {splits.map((s, i) => (
              <div key={i} className="flex gap-2">
                <select value={s.mode} onChange={(e) => updateSplit(i, "mode", e.target.value)}
                  className="border rounded-lg px-2 py-1.5 text-xs flex-1">
                  {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <input value={s.amount} onChange={(e) => updateSplit(i, "amount", e.target.value)}
                  placeholder="Amount" type="number" step="0.01"
                  className="border rounded-lg px-2 py-1.5 text-xs w-24" />
                <input value={s.ref} onChange={(e) => updateSplit(i, "ref", e.target.value)}
                  placeholder="Ref #" className="border rounded-lg px-2 py-1.5 text-xs flex-1" />
              </div>
            ))}
            <button onClick={addSplit} className="text-xs text-primary hover:underline">+ Add split</button>
          </div>
        ) : (
          <div>
            <label className="block text-xs font-medium mb-1">Reference / Txn ID</label>
            <input value={splits[0]?.ref ?? ""} onChange={(e) => updateSplit(0, "ref", e.target.value)}
              placeholder="Optional (UPI ID, card auth code...)"
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
        )}

        <button onClick={handleConfirm} disabled={loading}
          className="w-full bg-green-600 text-white py-2.5 rounded-lg font-semibold text-sm hover:bg-green-700 disabled:opacity-60 transition-colors">
          {loading ? "Processing..." : `Confirm ₹${total.toFixed(2)}`}
        </button>
      </div>
    </Modal>
  );
}
