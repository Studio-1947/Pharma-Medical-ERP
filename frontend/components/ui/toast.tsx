"use client";

import * as ToastPrimitive from "@radix-ui/react-toast";
import { createContext, useContext, useReducer, useCallback, ReactNode } from "react";
import { X, CheckCircle2, AlertCircle, Info, AlertTriangle, Copy, Check } from "lucide-react";
import { useState } from "react";
import { explainError } from "@/lib/error-message";

type ToastVariant = "success" | "error" | "info" | "warning";

interface Toast {
  id: string;
  title: string;
  description?: string;
  /** The next action, kept apart from the description so it reads as advice. */
  whatToDo?: string;
  /** Support code, shown only when there is one worth quoting. */
  reference?: string;
  variant: ToastVariant;
  duration?: number;
}

interface ToastContextValue {
  toast: (opts: Omit<Toast, "id">) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string, duration?: number) => void;
  info: (title: string, description?: string) => void;
  warning: (title: string, description?: string, duration?: number) => void;
  /**
   * Shows any thrown error in words a non-technical person can act on.
   *
   * Prefer this over hand-writing `err.response.data.message` into a toast:
   * that sentence is sometimes written for a human and sometimes not, and the
   * cases where it is not ("Request failed with status code 500") are exactly
   * the ones where the person most needs telling what to do.
   */
  fromError: (err: unknown, fallbackTitle?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

type Action =
  | { type: "ADD"; toast: Toast }
  | { type: "REMOVE"; id: string };

function reducer(state: Toast[], action: Action): Toast[] {
  switch (action.type) {
    case "ADD":
      return [...state, action.toast];
    case "REMOVE":
      return state.filter((t) => t.id !== action.id);
    default:
      return state;
  }
}

const ICONS: Record<ToastVariant, ReactNode> = {
  success: <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />,
  error: <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />,
  info: <Info className="w-5 h-5 text-cyan-600 shrink-0" />,
  warning: <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />,
};

const BORDER_STYLES: Record<ToastVariant, string> = {
  success: "border-emerald-200/80 bg-white/95 shadow-emerald-950/5",
  error: "border-rose-200/80 bg-white/95 shadow-rose-950/5",
  info: "border-cyan-200/80 bg-white/95 shadow-cyan-950/5",
  warning: "border-amber-200/80 bg-amber-50/95 shadow-amber-950/5",
};

const ICON_BG: Record<ToastVariant, string> = {
  success: "bg-emerald-50 text-emerald-600",
  error: "bg-rose-50 text-rose-600",
  info: "bg-cyan-50 text-cyan-600",
  warning: "bg-amber-100/60 text-amber-600",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, dispatch] = useReducer(reducer, []);

  const toast = useCallback((opts: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).slice(2);
    dispatch({ type: "ADD", toast: { ...opts, id } });
    setTimeout(() => dispatch({ type: "REMOVE", id }), opts.duration ?? 4500);
  }, []);

  const success = useCallback(
    (title: string, description?: string) =>
      toast({ title, description, variant: "success" }),
    [toast],
  );

  const error = useCallback(
    (title: string, description?: string, duration?: number) =>
      toast({ title, description, variant: "error", duration }),
    [toast],
  );

  const info = useCallback(
    (title: string, description?: string) =>
      toast({ title, description, variant: "info" }),
    [toast],
  );

  const warning = useCallback(
    (title: string, description?: string, duration?: number) =>
      toast({ title, description, variant: "warning", duration }),
    [toast],
  );

  const fromError = useCallback(
    (err: unknown, fallbackTitle?: string) => {
      const e = explainError(err);
      toast({
        title: fallbackTitle ?? e.title,
        description: e.message,
        whatToDo: e.whatToDo,
        reference: e.reference,
        variant: "error",
        // Long enough to read a reference off the screen and write it down.
        duration: e.reference ? 12000 : 7000,
      });
    },
    [toast],
  );

  return (
    <ToastContext.Provider value={{ toast, success, error, info, warning, fromError }}>
      <ToastPrimitive.Provider swipeDirection="right">
        {children}
        <ToastPrimitive.Viewport className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2.5 w-84 max-w-[calc(100vw-2.5rem)] outline-none" />
        {toasts.map((t) => (
          <ToastPrimitive.Root
            key={t.id}
            open
            onOpenChange={(open) => {
              if (!open) dispatch({ type: "REMOVE", id: t.id });
            }}
            className={`group relative border ${BORDER_STYLES[t.variant]} backdrop-blur-md rounded-2xl shadow-xl p-4 flex items-start gap-3.5 transition-all data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-bottom-5 overflow-hidden`}
          >
            <div className={`p-2 rounded-xl ${ICON_BG[t.variant]} shrink-0`}>
              {ICONS[t.variant]}
            </div>
            <div className="flex-1 min-w-0 pt-0.5">
              <ToastPrimitive.Title className="text-sm font-bold text-slate-900 leading-tight">
                {t.title}
              </ToastPrimitive.Title>
              {t.description && (
                <ToastPrimitive.Description className="text-xs font-medium text-slate-500 mt-1 leading-snug">
                  {t.description}
                </ToastPrimitive.Description>
              )}
              {t.whatToDo && (
                <p className="text-xs font-semibold text-slate-700 mt-1.5 leading-snug">
                  {t.whatToDo}
                </p>
              )}
              {t.reference && <ReferenceChip reference={t.reference} />}
            </div>
            <ToastPrimitive.Close
              className="shrink-0 p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

/**
 * The support code, with one tap to copy it.
 *
 * Someone reading this out over the phone should not have to transcribe it by
 * eye, and someone messaging it should not have to retype it.
 */
function ReferenceChip({ reference }: { reference: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(reference).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          },
          () => undefined,
        );
      }}
      className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
      aria-label={`Copy support reference ${reference}`}
    >
      {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : reference}
    </button>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}

