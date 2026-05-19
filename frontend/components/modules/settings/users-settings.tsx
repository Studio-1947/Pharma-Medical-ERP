"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  UserPlus,
  Search,
  ShieldCheck,
  ShieldOff,
  UserCheck,
  UserX,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { apiClient, queryKeys } from "@/lib/api-client";
import { Modal } from "@/components/ui/modal";

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

interface ApiListResponse {
  data: User[];
  meta: { total: number; page: number; totalPages: number; limit: number };
}

const ROLE_OPTIONS = [
  "SUPER_ADMIN",
  "ADMIN",
  "PHARMACIST",
  "CASHIER",
  "INVENTORY_MANAGER",
  "DISTRIBUTION_STAFF",
  "HR_MANAGER",
  "REPORTS_ANALYST",
];

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: "bg-purple-100 text-purple-700",
  ADMIN: "bg-blue-100 text-blue-700",
  PHARMACIST: "bg-green-100 text-green-700",
  CASHIER: "bg-amber-100 text-amber-700",
  INVENTORY_MANAGER: "bg-teal-100 text-teal-700",
  DISTRIBUTION_STAFF: "bg-orange-100 text-orange-700",
  HR_MANAGER: "bg-pink-100 text-pink-700",
  REPORTS_ANALYST: "bg-slate-100 text-slate-700",
};

const inputCls = (hasError = false) =>
  [
    "w-full rounded-lg border px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400",
    "focus:outline-none focus:ring-2 focus:ring-offset-0 transition-shadow",
    hasError
      ? "border-red-300 focus:ring-red-200 bg-red-50/30"
      : "border-slate-200 focus:ring-blue-100 focus:border-blue-400 bg-white hover:border-slate-300",
  ].join(" ");

interface InviteForm {
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  password: string;
}

function InviteUserModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<InviteForm>({
    email: "",
    firstName: "",
    lastName: "",
    role: "CASHIER",
    password: "",
  });
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (data: InviteForm) => apiClient.post("/users/invite", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.users.all() });
      onClose();
    },
    onError: (err: any) =>
      setError(err?.response?.data?.message ?? "Failed to invite user."),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    mutation.mutate(form);
  };

  const field = (key: keyof InviteForm) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value })),
  });

  return (
    <Modal
      title="Invite User"
      subtitle="Create a new user account and assign a role"
      icon={<UserPlus size={16} />}
      open={open}
      onClose={onClose}
      size="md"
    >
      <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">
              First Name <span className="text-red-500">*</span>
            </label>
            <input required placeholder="Jane" className={inputCls()} {...field("firstName")} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">
              Last Name <span className="text-red-500">*</span>
            </label>
            <input required placeholder="Doe" className={inputCls()} {...field("lastName")} />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">
            Email <span className="text-red-500">*</span>
          </label>
          <input
            required
            type="email"
            placeholder="jane@pharmacy.com"
            className={inputCls()}
            {...field("email")}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">
            Role <span className="text-red-500">*</span>
          </label>
          <select required className={inputCls()} {...field("role")}>
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">
            Temporary Password <span className="text-red-500">*</span>
          </label>
          <input
            required
            type="password"
            placeholder="Min 8 characters"
            minLength={8}
            className={inputCls()}
            {...field("password")}
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-600 text-sm">
            <AlertCircle size={14} />
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
            className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {mutation.isPending ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Inviting...
              </>
            ) : (
              <>
                <CheckCircle2 size={14} />
                Invite User
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function UsersSettings() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [roleEdit, setRoleEdit] = useState<{ id: string; role: string } | null>(null);

  const params = { search, page, limit: 20 };

  const { data, isLoading } = useQuery<ApiListResponse>({
    queryKey: [...queryKeys.users.all(), params],
    queryFn: () => apiClient.get("/users", { params }) as Promise<ApiListResponse>,
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/users/${id}/deactivate`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.users.all() }),
  });

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/users/${id}/reactivate`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.users.all() }),
  });

  const changeRoleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) =>
      apiClient.patch(`/users/${id}/role`, { role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.users.all() });
      setRoleEdit(null);
    },
  });

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search users..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <button
          onClick={() => setInviteOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90"
        >
          <UserPlus size={16} />
          Invite User
        </button>
      </div>

      {isLoading && <div className="text-center py-16 text-muted-foreground">Loading...</div>}

      {data && (
        <>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">User</th>
                  <th className="text-left px-4 py-3 font-medium">Role</th>
                  <th className="text-center px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Joined</th>
                  <th className="text-center px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.data.map((u) => (
                  <tr key={u.id} className="hover:bg-muted/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium">
                        {u.firstName} {u.lastName}
                      </div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      {roleEdit?.id === u.id ? (
                        <div className="flex items-center gap-1">
                          <select
                            value={roleEdit.role}
                            onChange={(e) => setRoleEdit({ id: u.id, role: e.target.value })}
                            className="border rounded text-xs px-2 py-1"
                          >
                            {ROLE_OPTIONS.map((r) => (
                              <option key={r} value={r}>
                                {r.replace(/_/g, " ")}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => changeRoleMutation.mutate({ id: u.id, role: roleEdit.role })}
                            className="text-xs text-green-600 hover:underline"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setRoleEdit(null)}
                            className="text-xs text-slate-500 hover:underline"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-xs font-medium cursor-pointer ${
                            ROLE_COLORS[u.role] ?? "bg-slate-100 text-slate-600"
                          }`}
                          onClick={() => setRoleEdit({ id: u.id, role: u.role })}
                          title="Click to change role"
                        >
                          {u.role.replace(/_/g, " ")}
                        </span>
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
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(u.createdAt).toLocaleDateString("en-IN")}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        {u.isActive ? (
                          <button
                            onClick={() => deactivateMutation.mutate(u.id)}
                            disabled={deactivateMutation.isPending}
                            className="flex items-center gap-1 text-xs text-red-500 hover:underline disabled:opacity-50"
                          >
                            <UserX size={12} />
                            Deactivate
                          </button>
                        ) : (
                          <button
                            onClick={() => reactivateMutation.mutate(u.id)}
                            disabled={reactivateMutation.isPending}
                            className="flex items-center gap-1 text-xs text-green-600 hover:underline disabled:opacity-50"
                          >
                            <UserCheck size={12} />
                            Reactivate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {data.data.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center py-16 text-muted-foreground">
                      No users found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
            <span>
              {data.meta.total} total &bull; page {data.meta.page} of {data.meta.totalPages}
            </span>
            <div className="flex gap-2">
              <button
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1 border rounded-lg disabled:opacity-40 hover:bg-muted"
              >
                Prev
              </button>
              <button
                disabled={page >= data.meta.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1 border rounded-lg disabled:opacity-40 hover:bg-muted"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      <InviteUserModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  );
}
