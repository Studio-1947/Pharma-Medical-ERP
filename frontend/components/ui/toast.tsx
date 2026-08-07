"use client";

import * as ToastPrimitive from "@radix-ui/react-toast";
import { createContext, useContext, useReducer, useCallback, ReactNode } from "react";
import { X, CheckCircle2, AlertCircle, Info, AlertTriangle } from "lucide-react";

type ToastVariant = "success" | "error" | "info" | "warning";

interface Toast {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
  duration?: number;
}

interface ToastContextValue {
  toast: (opts: Omit<Toast, "id">) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string, duration?: number) => void;
  info: (title: string, description?: string) => void;
  warning: (title: string, description?: string, duration?: number) => void;
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

  return (
    <ToastContext.Provider value={{ toast, success, error, info, warning }}>
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

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}

