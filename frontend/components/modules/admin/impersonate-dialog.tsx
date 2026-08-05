"use client";

import { useEffect, useState } from "react";
import { UserCog, AlertTriangle, Play } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { useStartImpersonation, extractError } from "@/queries/admin.queries";
import { startImpersonation } from "@/lib/impersonation";
import { roleLabel } from "./role-meta";

const inputCls =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-100 focus:border-emerald-400 bg-white";

const DURATIONS = [5, 15, 30, 60];

interface Props {
  open: boolean;
  onClose: () => void;
  user: {
    id: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    role: string;
    branchName?: string | null;
  } | null;
}

export function ImpersonateDialog({ open, onClose, user }: Props) {
  const { error: toastError } = useToast();
  const [durationMinutes, setDurationMinutes] = useState(15);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useStartImpersonation();

  useEffect(() => {
    if (!open) return;
    setDurationMinutes(15);
    setReason("");
    setError(null);
  }, [open]);

  const handleStart = () => {
    setError(null);
    mutation.mutate(
      { userId: user!.id, data: { durationMinutes, reason: reason || undefined } },
      {
        onSuccess: (raw: any) => {
          const res = raw?.data ?? raw;
          if (!res?.accessToken) {
            setError("The server did not return an impersonation token.");
            return;
          }
          startImpersonation(res);
          // Hard navigation: the sidebar, the route gate and every cached
          // query must re-derive under the new role.
          window.location.href = "/dashboard";
        },
        onError: (err) => {
          const msg = extractError(err, "Failed to start impersonation.");
          setError(msg);
          toastError("Could not impersonate", msg);
        },
      },
    );
  };

  const name =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email;

  return (
    <Modal
      title="Impersonate user"
      subtitle="View the system exactly as this user sees it"
      icon={<UserCog size={16} />}
      open={open}
      onClose={onClose}
      size="md"
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
          <p className="font-medium text-slate-800">{name}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            {user?.email} · {user ? roleLabel(user.role) : ""}
            {user?.branchName ? ` · ${user.branchName}` : ""}
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">
            Session length
          </label>
          <select
            className={inputCls}
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(Number(e.target.value))}
          >
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {d} minutes
              </option>
            ))}
          </select>
          <p className="text-xs text-slate-400 mt-1">
            The session cannot be renewed and ends automatically when it expires.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">
            Reason <span className="text-slate-400">(optional, recorded)</span>
          </label>
          <textarea
            rows={2}
            maxLength={500}
            className={inputCls}
            placeholder="Reproducing a billing issue reported by this user"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
          <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800">
            The session is <strong>read-only</strong>. You will see exactly what
            this user sees, but nothing can be created, edited or deleted —
            otherwise the record would name them rather than you. Administrative
            screens stay blocked, and the session is logged against your account.
          </p>
        </div>

        {error && (
          <div className="flex items-start gap-2 text-red-600 text-sm">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleStart}
            disabled={mutation.isPending}
            className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
          >
            {mutation.isPending ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <Play size={14} />
                Start impersonating
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
