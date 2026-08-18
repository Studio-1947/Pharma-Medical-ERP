"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RotateCcw, ChevronDown, ChevronUp } from "lucide-react";
import {
  getStuckInvoices,
  retryStuckInvoice,
  syncOfflineQueue,
  type OfflineInvoice,
} from "@/lib/pos-db";
import { apiClient } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { errorText } from "@/lib/error-message";

/**
 * Sales taken while offline that the server has repeatedly refused.
 *
 * A queued sale that keeps failing — the stock went in the meantime, the
 * prescription expired — used to retry silently on every reconnect and be
 * visible nowhere. Money had been taken at the counter and no invoice existed,
 * with nothing on screen to say so. This is the only place that state surfaces,
 * so it is deliberately loud and does not dismiss itself.
 *
 * Retrying is safe to do as often as you like: every queued payload carries an
 * idempotency key, so a sale the server did record comes back as that same
 * invoice rather than being billed a second time.
 */
export function StuckSalesBanner() {
  const [stuck, setStuck] = useState<OfflineInvoice[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const { success: toastSuccess, fromError: toastFromError } = useToast();

  const refresh = useCallback(async () => {
    try {
      setStuck(await getStuckInvoices());
    } catch {
      // The local database being unavailable is not worth interrupting a sale
      // over; the banner simply stays hidden.
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Cheap local read, and the queue only changes on sync or on a new offline
    // sale — neither of which this component is told about directly.
    const t = setInterval(() => void refresh(), 30_000);
    window.addEventListener("online", refresh);
    return () => {
      clearInterval(t);
      window.removeEventListener("online", refresh);
    };
  }, [refresh]);

  if (stuck.length === 0) return null;

  const handleRetry = async () => {
    setRetrying(true);
    try {
      for (const row of stuck) {
        if (row.id !== undefined) await retryStuckInvoice(row.id);
      }
      const { synced, failed } = await syncOfflineQueue(
        (p) => apiClient.post("/billing/invoices", p) as any,
      );
      if (synced > 0) {
        toastSuccess(
          "Sales recorded",
          `${synced} ${synced === 1 ? "sale has" : "sales have"} now gone through.`,
        );
      }
      if (failed > 0 && synced === 0) {
        toastFromError(
          new Error("still failing"),
          "Those sales still will not go through",
        );
      }
    } catch (err) {
      toastFromError(err, "Could not retry those sales");
    } finally {
      setRetrying(false);
      await refresh();
    }
  };

  return (
    <div className="mb-4 rounded-xl border-2 border-amber-300 bg-amber-50 overflow-hidden">
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="mt-0.5 shrink-0 rounded-lg bg-amber-100 p-1.5 text-amber-700">
          <AlertTriangle size={16} />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-amber-900">
            {stuck.length} {stuck.length === 1 ? "sale was" : "sales were"} taken offline and
            {stuck.length === 1 ? " has" : " have"} not been recorded
          </p>
          <p className="mt-0.5 text-xs font-medium text-amber-800">
            Money may have been collected for {stuck.length === 1 ? "this" : "these"} without an
            invoice being created. Retry {stuck.length === 1 ? "it" : "them"}, and if that still
            fails, enter {stuck.length === 1 ? "it" : "them"} again at the counter.
          </p>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleRetry}
              disabled={retrying}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-amber-800 disabled:opacity-50"
            >
              <RotateCcw size={13} className={retrying ? "animate-spin" : undefined} />
              {retrying ? "Retrying..." : "Retry now"}
            </button>

            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100"
              aria-expanded={expanded}
            >
              {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              {expanded ? "Hide details" : "Show details"}
            </button>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-amber-200 bg-amber-100/50 px-4 py-3">
          <ul className="space-y-2">
            {stuck.map((row) => (
              <li key={row.localId} className="text-xs">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono font-semibold text-amber-900">{row.localId}</span>
                  <span className="text-amber-800">
                    taken {new Date(row.createdAt).toLocaleString()}
                  </span>
                  <span className="text-amber-700">· {row.attempts} attempts</span>
                </div>
                {row.lastError && (
                  <p className="mt-0.5 text-amber-800">
                    Reason: {errorText(row.lastError)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
