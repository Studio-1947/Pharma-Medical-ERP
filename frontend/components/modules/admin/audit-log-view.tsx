"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, ScrollText } from "lucide-react";
import {
  useAuditLogs,
  useAuditActions,
  rowsOf,
  metaOf,
} from "@/queries/admin.queries";
import { roleColor, roleLabel } from "./role-meta";

const inputCls =
  "rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-100 focus:border-emerald-400";

interface AuditRow {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  oldValue: string | null;
  newValue: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  actor: {
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    role: string | null;
  } | null;
}

/** Values are text columns holding JSON; a parse failure shows the raw string. */
function prettyJson(value: string | null): string | null {
  if (!value) return null;
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

const ACTION_TONE: Record<string, string> = {
  IMPERSONATION_START: "bg-amber-100 text-amber-800",
  IMPERSONATION_STOP: "bg-amber-50 text-amber-700",
  ADMIN_PASSWORD_RESET: "bg-red-100 text-red-700",
  USER_DEACTIVATE: "bg-red-50 text-red-700",
  USER_ROLE_CHANGE: "bg-purple-100 text-purple-700",
  USER_CREATE: "bg-green-100 text-green-700",
  USER_REACTIVATE: "bg-green-50 text-green-700",
  SESSION_REVOKE: "bg-slate-100 text-slate-700",
  SESSIONS_REVOKE_ALL: "bg-slate-100 text-slate-700",
  USER_UPDATE: "bg-sky-100 text-sky-700",
};

export function AuditLogView() {
  const [action, setAction] = useState("");
  const [entity, setEntity] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const params = {
    ...(action ? { action } : {}),
    ...(entity ? { entity } : {}),
    ...(from ? { from: new Date(from).toISOString() } : {}),
    // A date input gives midnight; without this the "to" day is excluded.
    ...(to ? { to: new Date(`${to}T23:59:59.999`).toISOString() } : {}),
    page,
    limit: 50,
  };

  const { data: raw, isLoading } = useAuditLogs(params);
  const rows = rowsOf<AuditRow>(raw);
  const meta = metaOf(raw);

  const { data: actionsRaw } = useAuditActions();
  const actions: string[] = rowsOf<string>(actionsRaw);

  const reset = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Action</label>
          <select
            className={inputCls}
            value={action}
            onChange={(e) => reset(setAction)(e.target.value)}
          >
            <option value="">All actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Entity</label>
          <input
            className={inputCls}
            placeholder="users"
            value={entity}
            onChange={(e) => reset(setEntity)(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">From</label>
          <input
            type="date"
            className={inputCls}
            value={from}
            onChange={(e) => reset(setFrom)(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">To</label>
          <input
            type="date"
            className={inputCls}
            value={to}
            onChange={(e) => reset(setTo)(e.target.value)}
          />
        </div>
        {(action || entity || from || to) && (
          <button
            onClick={() => {
              setAction("");
              setEntity("");
              setFrom("");
              setTo("");
              setPage(1);
            }}
            className="px-3 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            Clear
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2 py-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-12 rounded-lg bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="w-8 px-2 py-3" />
                  <th className="text-left px-4 py-3 font-medium">Time</th>
                  <th className="text-left px-4 py-3 font-medium">Actor</th>
                  <th className="text-left px-4 py-3 font-medium">Action</th>
                  <th className="text-left px-4 py-3 font-medium">Entity</th>
                  <th className="text-left px-4 py-3 font-medium">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const isOpen = expanded === r.id;
                  const oldJson = prettyJson(r.oldValue);
                  const newJson = prettyJson(r.newValue);
                  const actorName =
                    [r.actor?.firstName, r.actor?.lastName]
                      .filter(Boolean)
                      .join(" ") ||
                    r.actor?.email ||
                    "System";

                  return (
                    <>
                      <tr
                        key={r.id}
                        className="hover:bg-slate-50/70 cursor-pointer"
                        onClick={() => setExpanded(isOpen ? null : r.id)}
                      >
                        <td className="px-2 py-3 text-slate-400">
                          {isOpen ? (
                            <ChevronDown size={14} />
                          ) : (
                            <ChevronRight size={14} />
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                          {new Date(r.createdAt).toLocaleString("en-IN")}
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-slate-800">{actorName}</div>
                          {r.actor?.role && (
                            <span
                              className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${roleColor(r.actor.role)}`}
                            >
                              {roleLabel(r.actor.role)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                              ACTION_TONE[r.action] ?? "bg-slate-100 text-slate-700"
                            }`}
                          >
                            {r.action.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {r.entity}
                          {r.entityId && (
                            <div className="text-[10px] text-slate-400 font-mono">
                              {r.entityId.slice(0, 8)}…
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500 font-mono">
                          {r.ipAddress ?? "—"}
                        </td>
                      </tr>

                      {isOpen && (
                        <tr key={`${r.id}-detail`} className="bg-slate-50/60">
                          <td colSpan={6} className="px-6 py-4">
                            <div className="grid gap-4 md:grid-cols-2">
                              <div>
                                <p className="text-xs font-semibold text-slate-600 mb-1">
                                  Before
                                </p>
                                <pre className="text-[11px] bg-white border border-slate-200 rounded-lg p-3 overflow-x-auto text-slate-700">
                                  {oldJson ?? "—"}
                                </pre>
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-slate-600 mb-1">
                                  After
                                </p>
                                <pre className="text-[11px] bg-white border border-slate-200 rounded-lg p-3 overflow-x-auto text-slate-700">
                                  {newJson ?? "—"}
                                </pre>
                              </div>
                            </div>
                            {r.userAgent && (
                              <p className="mt-3 text-[11px] text-slate-400 break-all">
                                {r.userAgent}
                              </p>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}

                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-16">
                      <ScrollText
                        size={28}
                        className="mx-auto text-slate-300 mb-3"
                      />
                      <p className="text-sm text-slate-500">
                        No audit entries yet.
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        Admin actions are recorded from the moment this console
                        is in use.
                      </p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>
              {meta?.total ?? rows.length} entries · page {meta?.page ?? page} of{" "}
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
