"use client";

import { useState } from "react";
import { Info, KeyRound } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import {
  useAdminSessions,
  useRevokeSession,
  rowsOf,
  metaOf,
  extractError,
} from "@/queries/admin.queries";
import { roleColor, roleLabel } from "./role-meta";

interface SessionRow {
  id: string;
  userId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  isActive: boolean;
}

/** Coarse device label — enough to recognise your own session in the list. */
function deviceOf(ua: string | null): string {
  if (!ua) return "Unknown";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad|iOS/.test(ua)
        ? "iOS"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} · ${os}` : browser;
}

export function SessionsView() {
  const { success: toastSuccess, error: toastError } = useToast();
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);
  const [confirming, setConfirming] = useState<string | null>(null);

  const params = { includeInactive: String(includeInactive), page, limit: 50 };
  const { data: raw, isLoading } = useAdminSessions(params);
  const rows = rowsOf<SessionRow>(raw);
  const meta = metaOf(raw);

  const revoke = useRevokeSession();

  const handleRevoke = (s: SessionRow) => {
    setConfirming(null);
    revoke.mutate(s.id, {
      onSuccess: () =>
        toastSuccess("Session revoked", `${s.email ?? "User"} cannot renew it.`),
      onError: (err) =>
        toastError(
          "Could not revoke session",
          extractError(err, "Could not revoke session"),
        ),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => {
              setIncludeInactive(e.target.checked);
              setPage(1);
            }}
            className="accent-emerald-600"
          />
          Include revoked and expired
        </label>
      </div>

      {/* Both statements below are load-bearing corrections to what the table
          would otherwise imply. */}
      <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5">
        <Info size={15} className="text-sky-600 shrink-0 mt-0.5" />
        <div className="text-xs text-sky-900 space-y-1">
          <p>
            Each row is one <strong>device</strong>, not one login. Sessions
            rotate on every renewal, so a single browser produces a chain of
            rows over time but only one active row at a time.
          </p>
          <p>
            Revoking stops a device from renewing its session. Its current
            access token stays valid until it expires.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2 py-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-12 rounded-lg bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">User</th>
                  <th className="text-left px-4 py-3 font-medium">Device</th>
                  <th className="text-left px-4 py-3 font-medium">IP</th>
                  <th className="text-left px-4 py-3 font-medium">Started</th>
                  <th className="text-left px-4 py-3 font-medium">Expires</th>
                  <th className="text-center px-4 py-3 font-medium">Status</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((s) => {
                  const name =
                    [s.firstName, s.lastName].filter(Boolean).join(" ") ||
                    s.email ||
                    "Deleted user";
                  return (
                    <tr key={s.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{name}</div>
                        <div className="text-xs text-slate-500">{s.email}</div>
                        {s.role && (
                          <span
                            className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${roleColor(s.role)}`}
                          >
                            {roleLabel(s.role)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600 text-xs">
                        {deviceOf(s.userAgent)}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-slate-500">
                        {s.ipAddress ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {new Date(s.createdAt).toLocaleString("en-IN")}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {new Date(s.expiresAt).toLocaleString("en-IN")}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                            s.isActive
                              ? "bg-green-100 text-green-700"
                              : s.revokedAt
                                ? "bg-red-100 text-red-700"
                                : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {s.isActive ? "Active" : s.revokedAt ? "Revoked" : "Expired"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {s.isActive ? (
                          confirming === s.id ? (
                            <span className="text-xs flex items-center justify-end gap-2">
                              <button
                                onClick={() => handleRevoke(s)}
                                className="font-semibold text-red-600 hover:underline"
                              >
                                Confirm
                              </button>
                              <button
                                onClick={() => setConfirming(null)}
                                className="text-slate-500 hover:underline"
                              >
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <button
                              onClick={() => setConfirming(s.id)}
                              className="text-xs text-red-500 hover:underline"
                            >
                              Revoke
                            </button>
                          )
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-16">
                      <KeyRound size={28} className="mx-auto text-slate-300 mb-3" />
                      <p className="text-sm text-slate-500">
                        No {includeInactive ? "" : "active "}sessions.
                      </p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>
              {meta?.total ?? rows.length} sessions · page {meta?.page ?? page} of{" "}
              {meta?.totalPages ?? 1}
            </span>
            <div className="flex gap-2">
              <button
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1 border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-50"
              >
                Prev
              </button>
              <button
                disabled={page >= (meta?.totalPages ?? 1)}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1 border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-50"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
