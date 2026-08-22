"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, ShieldAlert, Trash2 } from "lucide-react";
import { apiClient, queryKeys } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { Modal } from "@/components/ui/modal";

// Typed into the box before the delete unlocks. Long enough to be deliberate,
// short enough that nobody pastes it from somewhere else.
const CONFIRM_WORD = "DELETE";

interface Preview {
  candidates: number;
  deletable: number;
  blocked: number;
  blockedBy: { label: string; count: number }[];
  sideEffects: { prescriptionLinksCleared: number; doctorFavouritesRemoved: number };
  sample: { sku: string; name: string; manufacturer?: string | null; createdAt: string }[];
  dryRun: boolean;
  deleted: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

const n = (v: number) => v.toLocaleString("en-IN");

export function PurgeInactiveModal({ open, onClose }: Props) {
  const queryClient = useQueryClient();
  const { success: toastSuccess, error: toastError } = useToast();

  const [preview, setPreview] = useState<Preview | null>(null);
  const [typed, setTyped] = useState("");
  // Optional window, so the purge can be pinned to one import's rows rather
  // than every inactive medicine ever created.
  const [createdAfter, setCreatedAfter] = useState("");

  const body = () => ({
    ...(createdAfter ? { createdAfter } : {}),
  });

  const previewMutation = useMutation({
    mutationFn: () =>
      apiClient.post("/inventory/medicines/purge-inactive", {
        ...body(),
        dryRun: true,
      }) as Promise<any>,
    onSuccess: (res: any) => setPreview(res?.data ?? res),
    onError: (err: any) =>
      toastError("Preview failed", err?.response?.data?.message ?? "Could not read the catalogue."),
  });

  const purgeMutation = useMutation({
    mutationFn: () =>
      apiClient.post("/inventory/medicines/purge-inactive", {
        ...body(),
        dryRun: false,
        // Echoed back so the server can refuse if the number moved since the
        // preview was rendered.
        expectedCount: preview?.deletable ?? -1,
      }) as Promise<any>,
    onSuccess: (res: any) => {
      const r: Preview = res?.data ?? res;
      queryClient.invalidateQueries({ queryKey: queryKeys.medicines.all() });
      toastSuccess(`${n(r.deleted)} medicines deleted`, "Their SKUs are free for a re-import.");
      handleClose();
    },
    onError: (err: any) =>
      toastError(
        "Nothing was deleted",
        err?.response?.data?.message ?? "The purge did not run. The catalogue is unchanged.",
      ),
  });

  // Re-read on open, and again whenever the window changes, so the number on
  // the confirm button is never one the operator has not just been shown.
  useEffect(() => {
    if (!open) return;
    setTyped("");
    setPreview(null);
    previewMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, createdAfter]);

  function handleClose() {
    setPreview(null);
    setTyped("");
    setCreatedAfter("");
    onClose();
  }

  const armed = typed.trim().toUpperCase() === CONFIRM_WORD && (preview?.deletable ?? 0) > 0;
  const busy = previewMutation.isPending || purgeMutation.isPending;

  return (
    <Modal
      title="Delete inactive medicines"
      subtitle="Removes catalogue rows a CSV import parked inactive because they carried no MRP."
      icon={<ShieldAlert size={16} />}
      open={open}
      onClose={busy ? () => {} : handleClose}
      size="xl"
    >
      <div className="space-y-5" data-pharmerp-unsaved={busy ? "purge-inactive" : undefined}>
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-800">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <span>
            This is a permanent delete, not a deactivation &mdash; it has to be, because a
            soft-deleted row keeps its SKU and would block your corrected re-import.{" "}
            <b>Take a database backup first.</b>
          </span>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">
            Only medicines created on or after (optional)
          </label>
          <input
            type="date"
            value={createdAfter}
            disabled={busy}
            onChange={(e) => setCreatedAfter(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Pin this to your import date so the purge cannot reach a medicine somebody
            deactivated by hand.
          </p>
        </div>

        {previewMutation.isPending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
            <Loader2 size={16} className="animate-spin" />
            Counting...
          </div>
        )}

        {preview && !previewMutation.isPending && (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border p-3">
                <div className="text-xs text-muted-foreground">Matching</div>
                <div className="text-xl font-bold text-slate-900">{n(preview.candidates)}</div>
              </div>
              <div className="rounded-xl border border-red-200 bg-red-50/50 p-3">
                <div className="text-xs text-red-700">Will be deleted</div>
                <div className="text-xl font-bold text-red-700">{n(preview.deletable)}</div>
              </div>
              <div className="rounded-xl border p-3">
                <div className="text-xs text-muted-foreground">Held back</div>
                <div className="text-xl font-bold text-slate-900">{n(preview.blocked)}</div>
              </div>
            </div>

            {preview.blockedBy.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
                <p className="font-semibold mb-1">
                  Kept because they already carry real history:
                </p>
                <ul className="space-y-0.5">
                  {preview.blockedBy.map((b) => (
                    <li key={b.label}>
                      {n(b.count)} have {b.label}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5">Price these by hand instead of re-importing them.</p>
              </div>
            )}

            {(preview.sideEffects.prescriptionLinksCleared > 0 ||
              preview.sideEffects.doctorFavouritesRemoved > 0) && (
              <div className="rounded-xl border px-3 py-2.5 text-xs text-slate-700">
                <p className="font-semibold mb-1">Also affected:</p>
                {preview.sideEffects.prescriptionLinksCleared > 0 && (
                  <p>
                    {n(preview.sideEffects.prescriptionLinksCleared)} prescription lines lose their
                    catalogue link (the medicine name written on them is kept).
                  </p>
                )}
                {preview.sideEffects.doctorFavouritesRemoved > 0 && (
                  <p>
                    {n(preview.sideEffects.doctorFavouritesRemoved)} doctor favourite-list entries
                    are removed.
                  </p>
                )}
              </div>
            )}

            {preview.sample.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-600 mb-1.5">
                  Sample of what will go ({preview.sample.length} of {n(preview.deletable)}):
                </p>
                <div className="max-h-48 overflow-y-auto rounded-lg border divide-y">
                  {preview.sample.map((m) => (
                    <div key={m.sku} className="px-3 py-1.5 text-xs flex gap-3">
                      <span className="font-mono text-slate-500 shrink-0 w-24">{m.sku}</span>
                      <span className="truncate text-slate-800">{m.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {preview.deletable === 0 ? (
              <p className="text-sm text-muted-foreground py-2">
                Nothing matches. There is nothing to delete.
              </p>
            ) : (
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Type <span className="font-mono text-red-600">{CONFIRM_WORD}</span> to confirm
                </label>
                <input
                  value={typed}
                  disabled={busy}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={CONFIRM_WORD}
                  className="w-48 border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-400 disabled:opacity-60"
                />
              </div>
            )}
          </>
        )}

        <div className="flex justify-end gap-2 pt-1 border-t">
          <button
            onClick={handleClose}
            disabled={busy}
            className="px-4 py-2 mt-3 border rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            onClick={() => purgeMutation.mutate()}
            disabled={!armed || busy}
            className="px-4 py-2 mt-3 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-40 disabled:hover:bg-red-600 flex items-center gap-2"
          >
            {purgeMutation.isPending ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Trash2 size={15} />
            )}
            Delete {preview ? n(preview.deletable) : ""} medicines
          </button>
        </div>
      </div>
    </Modal>
  );
}
