"use client";

import { useState } from "react";
import { Lock, Shield, Key, Clock, AlertCircle, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

const inputCls = (hasError = false) =>
  [
    "w-full rounded-lg border px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400",
    "focus:outline-none focus:ring-2 focus:ring-offset-0 transition-shadow",
    hasError
      ? "border-red-300 focus:ring-red-200 bg-red-50/30"
      : "border-slate-200 focus:ring-emerald-100 focus:border-emerald-400 bg-white hover:border-slate-300",
  ].join(" ");

function ChangePasswordForm() {
  const [form, setForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const mutation = useMutation({
    mutationFn: (data: { currentPassword: string; newPassword: string }) =>
      apiClient.post("/auth/change-password", data),
    onSuccess: () => {
      setSuccess(true);
      setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setTimeout(() => setSuccess(false), 3000);
    },
    onError: (err: any) =>
      setError(err?.response?.data?.message ?? "Failed to change password."),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (form.newPassword !== form.confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    if (form.newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    mutation.mutate({
      currentPassword: form.currentPassword,
      newPassword: form.newPassword,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1.5">
          Current Password
        </label>
        <div className="relative">
          <input
            required
            type={showCurrent ? "text" : "password"}
            value={form.currentPassword}
            onChange={(e) => setForm((f) => ({ ...f, currentPassword: e.target.value }))}
            className={`${inputCls()} pr-10`}
          />
          <button
            type="button"
            onClick={() => setShowCurrent((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
            aria-label={showCurrent ? "Hide password" : "Show password"}
          >
            {showCurrent ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1.5">
          New Password
        </label>
        <div className="relative">
          <input
            required
            type={showNew ? "text" : "password"}
            value={form.newPassword}
            onChange={(e) => setForm((f) => ({ ...f, newPassword: e.target.value }))}
            className={`${inputCls()} pr-10`}
          />
          <button
            type="button"
            onClick={() => setShowNew((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
            aria-label={showNew ? "Hide password" : "Show password"}
          >
            {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1.5">
          Confirm New Password
        </label>
        <div className="relative">
          <input
            required
            type={showConfirm ? "text" : "password"}
            value={form.confirmPassword}
            onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))}
            className={`${inputCls(!!error && form.confirmPassword !== form.newPassword)} pr-10`}
          />
          <button
            type="button"
            onClick={() => setShowConfirm((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
            aria-label={showConfirm ? "Hide password" : "Show password"}
          >
            {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-600 text-sm">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 text-green-600 text-sm">
          <CheckCircle2 size={14} />
          <span>Password changed successfully.</span>
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={mutation.isPending}
          className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
        >
          {mutation.isPending ? (
            <>
              <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Key size={14} />
              Change Password
            </>
          )}
        </button>
      </div>
    </form>
  );
}

function SecurityInfoCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-xl border bg-slate-50">
      <div className="mt-0.5 text-slate-500">{icon}</div>
      <div>
        <p className="text-sm font-medium text-slate-700">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
    </div>
  );
}

export function SecuritySettings() {
  return (
    <div className="space-y-6 max-w-xl">
      {/* Security info */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <SecurityInfoCard
          icon={<Shield size={18} />}
          title="RS256 JWT Tokens"
          description="Access tokens expire after 15 minutes. Refresh tokens last 7 days."
        />
        <SecurityInfoCard
          icon={<Clock size={18} />}
          title="Session Security"
          description="Sessions are tracked per device and invalidated on logout. Active sessions can be managed from Admin Console."
        />
        <SecurityInfoCard
          icon={<Lock size={18} />}
          title="Argon2id Passwords"
          description="All passwords are hashed with Argon2id (memory-hard, OWASP recommended)."
        />
        <SecurityInfoCard
          icon={<AlertCircle size={18} />}
          title="Audit Logging"
          description="All financial, inventory, and clinical mutations are logged with client IP address and user identity."
        />
      </div>

      {/* Change password */}
      <div className="rounded-xl border bg-white p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <Key size={16} className="text-emerald-600" />
          Change Password
        </h3>
        <ChangePasswordForm />
      </div>
    </div>
  );
}
