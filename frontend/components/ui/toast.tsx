"use client";

import * as ToastPrimitive from "@radix-ui/react-toast";
import { createContext, useContext, useReducer, useCallback, ReactNode } from "react";
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from "lucide-react";

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
  success: <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />,
  error: <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />,
  info: <Info className="w-4 h-4 text-blue-500 shrink-0" />,
  warning: <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />,
};

const BORDER: Record<ToastVariant, string> = {
  success: "border-green-200",
  error: "border-red-200",
  info: "border-blue-200",
  warning: "border-amber-200 bg-amber-50",
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
        <ToastPrimitive.Viewport className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 w-80 outline-none" />
        {toasts.map((t) => (
          <ToastPrimitive.Root
            key={t.id}
            open
            onOpenChange={(open) => {
              if (!open) dispatch({ type: "REMOVE", id: t.id });
            }}
            className={`border ${BORDER[t.variant]} bg-white rounded-lg shadow-lg p-4 flex items-start gap-3 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-bottom-5`}
          >
            {ICONS[t.variant]}
            <div className="flex-1 min-w-0">
              <ToastPrimitive.Title className="text-sm font-semibold text-gray-900 leading-tight">
                {t.title}
              </ToastPrimitive.Title>
              {t.description && (
                <ToastPrimitive.Description className="text-xs text-gray-500 mt-0.5 leading-snug">
                  {t.description}
                </ToastPrimitive.Description>
              )}
            </div>
            <ToastPrimitive.Close
              className="shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Close"
            >
              <X className="w-3.5 h-3.5" />
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
