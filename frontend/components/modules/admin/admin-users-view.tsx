"use client";

import { useState } from "react";
import {
  Search,
  UserPlus,
  Pencil,
  KeyRound,
  UserCog,
  UserX,
  UserCheck,
  LogOut,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { useAuthStore } from "@/stores/auth.store";
import {
  useAdminUsers,
  useBranches,
  useDeactivateUser,
  useReactivateUser,
  useRevokeAllSessions,
  rowsOf,
  metaOf,
  extractError,
} from "@/queries/admin.queries";
import { ROLE_OPTIONS, roleColor, roleLabel } from "./role-meta";
import { UserFormModal, type EditableUser } from "./user-form-modal";
import { SetPasswordModal } from "./set-password-modal";
import { ImpersonateDialog } from "./impersonate-dialog";

const selectCls =
  "rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-100 focus:border-emerald-400";

interface AdminUser extends EditableUser {
  branchName?: string | null;
  lastLoginAt?: string | null;
  createdAt?: string;
}

export function AdminUsersView() {
  const { success: toastSuccess, error: toastError } = useToast();
  const currentUser = useAuthStore((s) => s.user);

  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [branchId, setBranchId] = useState("");
  const [activeFilter, setActiveFilter] = useState("");
  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [pwTarget, setPwTarget] = useState<AdminUser | null>(null);
  const [impTarget, setImpTarget] = useState<AdminUser | null>(null);
  // Two-step inline confirm rather than window.confirm, matching the rest of
  // the app. Keyed by `${action}:${id}`.
  const [confirming, setConfirming] = useState<string | null>(null);

  const params = {
    ...(search ? { search } : {}),
    ...(role ? { role } : {}),
    ...(branchId ? { branchId } : {}),
    ...(activeFilter ? { isActive: activeFilter } : {}),
    page,
    limit: 25,
  };

  const { data: raw, isLoading } = useAdminUsers(params);
  const users = rowsOf<AdminUser>(raw);
  const meta = metaOf(raw);

  const { data: branchesRaw } = useBranches();
  const branches = rowsOf<any>(branchesRaw);

  const deactivate = useDeactivateUser();
  const reactivate = useReactivateUser();
  const revokeAll = useRevokeAllSessions();

  const resetPaging = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };

  const run = (
    mutation: { mutate: Function },
    arg: unknown,
    okTitle: string,
    okBody: string,
    failTitle: string,
  ) => {
    setConfirming(null);
    (mutation.mutate as any)(arg, {
      onSuccess: () => toastSuccess(okTitle, okBody),
      onError: (err: any) => toastError(failTitle, extractError(err, failTitle)),
    });
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            placeholder="Search name or email..."
            value={search}
            onChange={(e) => resetPaging(setSearch)(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-100 focus:border-emerald-400"
          />
        </div>

        <select
          className={selectCls}
          value={role}
          onChange={(e) => resetPaging(setRole)(e.target.value)}
        >
          <option value="">All roles</option>
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {roleLabel(r)}
            </option>
          ))}
        </select>

        <select
          className={selectCls}
          value={branchId}
          onChange={(e) => resetPaging(setBranchId)(e.target.value)}
        >
          <option value="">All branches</option>
          {branches.map((b: any) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>

        <select
          className={selectCls}
          value={activeFilter}
          onChange={(e) => resetPaging(setActiveFilter)(e.target.value)}
        >
          <option value="">Any status</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>

        <button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
          className="ml-auto flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700"
        >
          <UserPlus size={16} />
          Create user
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-2 py-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 rounded-lg bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">User</th>
                  <th className="text-left px-4 py-3 font-medium">Role</th>
                  <th className="text-left px-4 py-3 font-medium">Branch</th>
                  <th className="text-center px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Last login</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => {
                  const isSelf = currentUser?.id === u.id;
                  const name =
                    [u.firstName, u.lastName].filter(Boolean).join(" ") || "—";

                  return (
                    <tr key={u.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">
                          {name}
                          {isSelf && (
                            <span className="ml-2 text-[10px] uppercase tracking-wide text-emerald-600">
                              you
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500">{u.email}</div>
                      </td>

                      <td className="px-4 py-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${roleColor(u.role)}`}
                        >
                          {roleLabel(u.role)}
                        </span>
                      </td>

                      <td className="px-4 py-3 text-slate-600">
                        {u.branchName ?? (
                          <span className="text-slate-400">All branches</span>
                        )}
                      </td>

                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                            u.isActive
                              ? "bg-green-100 text-green-700"
                              : "bg-red-100 text-red-700"
                          }`}
                        >
                          {u.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>

                      <td className="px-4 py-3 text-xs text-slate-500">
                        {u.lastLoginAt
                          ? new Date(u.lastLoginAt).toLocaleString("en-IN")
                          : "Never"}
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          {confirming === `deactivate:${u.id}` ? (
                            <ConfirmPair
                              label="Deactivate?"
                              onConfirm={() =>
                                run(
                                  deactivate,
                                  u.id,
                                  "User deactivated",
                                  `${u.email} can no longer sign in.`,
                                  "Could not deactivate user",
                                )
                              }
                              onCancel={() => setConfirming(null)}
                            />
                          ) : confirming === `revoke:${u.id}` ? (
                            <ConfirmPair
                              label="Sign out everywhere?"
                              onConfirm={() =>
                                run(
                                  revokeAll,
                                  u.id,
                                  "Sessions revoked",
                                  `${u.email} must sign in again to renew.`,
                                  "Could not revoke sessions",
                                )
                              }
                              onCancel={() => setConfirming(null)}
                            />
                          ) : (
                            <>
                              <IconAction
                                title="Edit user"
                                icon={Pencil}
                                onClick={() => {
                                  setEditing(u);
                                  setFormOpen(true);
                                }}
                              />
                              <IconAction
                                title="Reset password"
                                icon={KeyRound}
                                disabled={isSelf}
                                onClick={() => setPwTarget(u)}
                              />
                              <IconAction
                                title={
                                  u.role === "super_admin"
                                    ? "Cannot impersonate a super admin"
                                    : "Impersonate"
                                }
                                icon={UserCog}
                                disabled={
                                  isSelf || !u.isActive || u.role === "super_admin"
                                }
                                onClick={() => setImpTarget(u)}
                              />
                              <IconAction
                                title="Revoke all sessions"
                                icon={LogOut}
                                onClick={() => setConfirming(`revoke:${u.id}`)}
                              />
                              {u.isActive ? (
                                <IconAction
                                  title={
                                    isSelf
                                      ? "You cannot deactivate yourself"
                                      : "Deactivate"
                                  }
                                  icon={UserX}
                                  tone="danger"
                                  disabled={isSelf}
                                  onClick={() =>
                                    setConfirming(`deactivate:${u.id}`)
                                  }
                                />
                              ) : (
                                <IconAction
                                  title="Reactivate"
                                  icon={UserCheck}
                                  tone="success"
                                  onClick={() =>
                                    run(
                                      reactivate,
                                      u.id,
                                      "User reactivated",
                                      `${u.email} can sign in again.`,
                                      "Could not reactivate user",
                                    )
                                  }
                                />
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {users.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="text-center py-16 text-slate-400 text-sm"
                    >
                      No users match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>
              {meta?.total ?? users.length} total · page {meta?.page ?? page} of{" "}
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

      <UserFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        user={editing}
      />
      <SetPasswordModal
        open={!!pwTarget}
        onClose={() => setPwTarget(null)}
        user={pwTarget}
      />
      <ImpersonateDialog
        open={!!impTarget}
        onClose={() => setImpTarget(null)}
        user={impTarget}
      />
    </div>
  );
}

function IconAction({
  title,
  icon: Icon,
  onClick,
  disabled,
  tone = "default",
}: {
  title: string;
  icon: React.ElementType;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "danger" | "success";
}) {
  const toneCls =
    tone === "danger"
      ? "text-red-500 hover:bg-red-50"
      : tone === "success"
        ? "text-green-600 hover:bg-green-50"
        : "text-slate-500 hover:bg-slate-100 hover:text-slate-800";

  return (
    <button
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`p-1.5 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${toneCls}`}
    >
      <Icon size={15} />
    </button>
  );
}

function ConfirmPair({
  label,
  onConfirm,
  onCancel,
}: {
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-slate-600">{label}</span>
      <button
        onClick={onConfirm}
        className="font-semibold text-red-600 hover:underline"
      >
        Confirm
      </button>
      <button onClick={onCancel} className="text-slate-500 hover:underline">
        Cancel
      </button>
    </div>
  );
}
