"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Sparkles, X } from "lucide-react";

interface PwaUpdatePromptProps {
  open: boolean;
  onApply: () => void;
  onDismiss: () => void;
}

export function PwaUpdatePrompt({
  open,
  onApply,
  onDismiss,
}: PwaUpdatePromptProps) {
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!open) setApplying(false);
  }, [open]);

  if (!open) return null;

  const handleApply = () => {
    setApplying(true);
    onApply();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[10000] w-[calc(100vw-2rem)] max-w-md p-4 bg-slate-900 text-white rounded-2xl shadow-2xl border border-slate-700 flex items-center justify-between gap-3 animate-in slide-in-from-bottom duration-300"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white shrink-0 shadow-sm">
          <Sparkles size={20} />
        </div>
        <div className="leading-tight min-w-0">
          <p className="text-xs font-extrabold text-white">
            A new version of PharmERP is ready
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Reload to apply. Your queued offline invoices are kept.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={handleApply}
          disabled={applying}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-70 text-white text-xs font-bold rounded-xl shadow-sm transition-all"
        >
          <RefreshCw size={14} className={applying ? "animate-spin" : undefined} />
          <span>{applying ? "Updating" : "Update"}</span>
        </button>
        <button
          onClick={onDismiss}
          className="p-1.5 text-slate-400 hover:text-white rounded-lg transition-colors"
          aria-label="Dismiss update notice"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
