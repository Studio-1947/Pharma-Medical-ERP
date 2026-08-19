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

  // Applying always ends in a reload, so the spinner normally dies with the
  // page. If that reload is blocked for any reason, fall back to an offerable
  // button rather than leaving a control that spins for ever.
  useEffect(() => {
    if (!applying) return;
    const timer = setTimeout(() => setApplying(false), 10_000);
    return () => clearTimeout(timer);
  }, [applying]);

  if (!open) return null;

  const handleApply = () => {
    setApplying(true);
    onApply();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      // Centred with `left/right + mx-auto` rather than `-translate-x-1/2`:
      // `animate-in` resolves to `fade-in ... both`, whose final keyframe sets
      // `transform: translateY(0)` and would permanently cancel a translate
      // used for centring, leaving the card hanging off the right edge.
      //
      // Below lg the mobile bottom nav owns the bottom edge, so the card is
      // lifted clear of it (and of the iOS home indicator) instead of sitting
      // on top of the nav buttons.
      className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] lg:bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] left-3 right-3 sm:left-4 sm:right-4 mx-auto z-[10000] max-w-md p-3 sm:p-4 bg-slate-900 text-white rounded-2xl shadow-2xl border border-slate-700 animate-in grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-3 sm:flex sm:items-center sm:justify-between sm:gap-3"
    >
      <div className="col-start-1 row-start-1 flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white shrink-0 shadow-sm">
          <Sparkles size={18} className="sm:w-5 sm:h-5" />
        </div>
        <div className="leading-tight min-w-0">
          <p className="text-xs font-extrabold text-white">
            A new version is ready
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5 break-words">
            Reload to apply. Your queued offline invoices are kept.
          </p>
        </div>
      </div>

      {/* Full-width primary action on its own row on phones, inline on sm+. */}
      <button
        onClick={handleApply}
        disabled={applying}
        className="col-span-2 row-start-2 w-full sm:w-auto min-h-[2.75rem] sm:min-h-0 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-70 text-white text-xs font-bold rounded-xl shadow-sm transition-all shrink-0"
      >
        <RefreshCw size={14} className={applying ? "animate-spin" : undefined} />
        <span>{applying ? "Updating" : "Update"}</span>
      </button>

      <button
        onClick={onDismiss}
        className="col-start-2 row-start-1 justify-self-end p-2 sm:p-1.5 text-slate-400 hover:text-white rounded-lg transition-colors shrink-0"
        aria-label="Dismiss update notice"
      >
        <X size={16} />
      </button>
    </div>
  );
}
