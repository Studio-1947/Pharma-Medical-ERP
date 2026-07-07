"use client";

import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

interface Props {
  title: string;
  subtitle?: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
  icon?: ReactNode;
}

const sizeMap = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-2xl",
  xl: "max-w-3xl",
  "2xl": "max-w-5xl",
};

export function Modal({ title, subtitle, open, onClose, children, size = "lg", icon }: Props) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose, open]);

  // Lock body scroll while open
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" aria-modal="true" role="dialog">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity animate-in fade-in duration-150"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={`relative w-full ${sizeMap[size]} bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl ring-1 ring-black/5 max-h-[94dvh] sm:max-h-[92dvh] flex flex-col animate-in fade-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-150`}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-4 py-4 sm:px-6 sm:py-5 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-3">
            {icon && (
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 shrink-0">
                {icon}
              </div>
            )}
            <div>
              <h2 className="text-base font-semibold text-slate-900 leading-tight">{title}</h2>
              {subtitle && (
                <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="ml-4 p-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-600 shrink-0"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">{children}</div>
      </div>
    </div>
  );
}
