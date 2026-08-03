"use client";

import { useEffect, useState } from "react";
import { KeyRound, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { useSetUserPassword, extractError } from "@/queries/admin.queries";

const inputCls = (hasError = false) =>
  [
    "w-full rounded-lg border px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400",
    "focus:outline-none focus:ring-2 focus:ring-offset-0 transition-shadow",
    hasError
      ? "border-red-300 focus:ring-red-200 bg-red-50/30"
      : "border-slate-200 focus:ring-emerald-100 focus:border-emerald-400 bg-white hover:border-slate-300",
  ].join(" ");

interface Props {
  open: boolean;
  onClose: () => void;
  user: { id: string; email: string } | null;
}

/** Mirrors adminSetPasswordSchema so the error is immediate; server is authoritative. */
function validate(pw: string): string | null {
  if (pw.length < 8) return "Must be at least 8 characters";
  if (!/[A-Z]/.test(pw)) return "Must contain an uppercase letter";
  if (!/[0-9]/.test(pw)) return "Must contain a number";
  return null;
}

export function SetPasswordModal({ open, onClose, user }: Props) {
  const { success: toastSuccess, error: toastError } = useToast();
  const [password, setPassword] = useState("");
  const [revokeSessions, setRevokeSessions] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mutation = useSetUserPassword();

  useEffect(() => {
    if (!open) return;
    setPassword("");
    setRevokeSessions(true);
    setError(null);
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validate(password);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);

    mutation.mutate(
      { id: user!.id, data: { newPassword: password, revokeSessions } },
      {
        onSuccess: () => {
          toastSuccess("Password reset", `${user!.email} must sign in again.`);
          onClose();
        },
        onError: (err) => {
          const msg = extractError(err, "Failed to reset the password.");
          setError(msg);
          toastError("Could not reset password", msg);
        },
      },
    );
  };

  return (
    <Modal
      title="Reset password"
      subtitle={user?.email}
      icon={<KeyRound size={16} />}
      open={open}
      onClose={onClose}
      size="sm"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">
            New password <span className="text-red-500">*</span>
          </label>
          <input
            required
            type="password"
            autoComplete="new-password"
            placeholder="Min 8 chars, one uppercase, one number"
            className={inputCls(!!error)}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(null);
            }}
          />
        </div>

        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={revokeSessions}
            onChange={(e) => setRevokeSessions(e.target.checked)}
            className="mt-0.5 accent-emerald-600"
          />
          <span className="text-xs text-slate-600">
            Sign the user out everywhere.{" "}
            <span className="text-slate-400">
              Leave this on if you believe the password was compromised —
              otherwise existing sessions keep working.
            </span>
          </span>
        </label>

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
            type="submit"
            disabled={mutation.isPending}
            className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
          >
            {mutation.isPending ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Resetting...
              </>
            ) : (
              <>
                <CheckCircle2 size={14} />
                Reset password
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
