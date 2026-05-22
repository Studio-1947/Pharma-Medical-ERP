"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  UserPlus, Search, Download, Shield, CheckCircle2, XCircle,
  Edit2, Trash2, X, User, Briefcase, Loader2, AlertCircle, CalendarDays,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { format } from "date-fns";
import { Modal } from "@/components/ui/modal";
import { StaffForm } from "@/components/modules/staff/staff-form";
import { StaffLeaveModal } from "@/components/modules/staff/staff-leave-modal";
import { apiClient, queryKeys } from "@/lib/api-client";
import { UserDto, UserRole } from "@pharmerp/types";

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  super_admin: "Super Admin",
  pharmacist: "Pharmacist",
  cashier: "Cashier",
  inventory_manager: "Inventory Manager",
  distribution_staff: "Distribution Staff",
  hr_manager: "HR Manager",
  reports_analyst: "Reports Analyst",
};

const ROLE_COLOR: Record<string, string> = {
  admin: "bg-purple-100 text-purple-700",
  super_admin: "bg-purple-100 text-purple-700",
  pharmacist: "bg-green-100 text-green-700",
  cashier: "bg-amber-100 text-amber-700",
  inventory_manager: "bg-blue-100 text-blue-700",
  distribution_staff: "bg-cyan-100 text-cyan-700",
  hr_manager: "bg-rose-100 text-rose-700",
  reports_analyst: "bg-slate-100 text-slate-700",
};

const ROLE_OPTIONS = [
  { value: "", label: "All Roles" },
  ...Object.entries(ROLE_LABEL).map(([v, l]) => ({ value: v, label: l })),
];

const EDIT_ROLE_OPTIONS = Object.entries(ROLE_LABEL)
  .filter(([v]) => v !== "super_admin")
  .map(([v, l]) => ({ value: v, label: l }));

function exportToCsv(users: UserDto[]) {
  const header = ["Name", "Email", "Role", "Status", "Joined"];
  const rows = users.map((u) => [
    `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim(),
    u.email,
    ROLE_LABEL[u.role ?? ""] ?? (u.role ?? ""),
    u.isActive ? "Active" : "Inactive",
    u.createdAt ? format(new Date(u.createdAt), "yyyy-MM-dd") : "",
  ]);
  const csv = [header, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `staff-${format(new Date(), "yyyy-MM-dd")}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function StaffManagementClient() {
  const { success: toastSuccess, error: toastError } = useToast();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "active" | "inactive">("");
  const [showFilters, setShowFilters] = useState(false);

  const [editingUser, setEditingUser] = useState<UserDto | null>(null);
  const [editForm, setEditForm] = useState({ firstName: "", lastName: "", role: "", isActive: true });
  const [leaveUser, setLeaveUser] = useState<UserDto | null>(null);

  const queryClient = useQueryClient();

  const { data: rawUsers, isLoading } = useQuery({
    queryKey: queryKeys.users.all(),
    queryFn: () => apiClient.get("/users"),
  });

  const users: UserDto[] = (
    Array.isArray(rawUsers) ? rawUsers : (rawUsers as any)?.data ?? []
  ) as UserDto[];

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      apiClient.patch(`/users/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all() });
      toastSuccess("Staff updated", "The account details have been saved.");
      setEditingUser(null);
    },
    onError: (err: any) => {
      toastError("Update failed", err?.response?.data?.message ?? "Could not save changes.");
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/users/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all() });
      toastSuccess("Account deactivated", "The user has lost system access.");
      setConfirmDeactivateId(null);
    },
    onError: () => {
      toastError("Failed", "Could not deactivate this account.");
      setConfirmDeactivateId(null);
    },
  });

  function openEdit(user: UserDto) {
    setEditingUser(user);
    setEditForm({
      firstName: user.firstName ?? "",
      lastName: user.lastName ?? "",
      role: user.role ?? "",
      isActive: user.isActive ?? true,
    });
  }

  const filtered = users.filter((u) => {
    const name = `${u.firstName ?? ""} ${u.lastName ?? ""} ${u.email ?? ""}`.toLowerCase();
    if (search && !name.includes(search.toLowerCase())) return false;
    if (roleFilter && u.role !== roleFilter) return false;
    if (statusFilter === "active" && !u.isActive) return false;
    if (statusFilter === "inactive" && u.isActive) return false;
    return true;
  });

  const activeFilters = [roleFilter, statusFilter, search].filter(Boolean).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Staff Accounts</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Manage system login accounts, roles, and access permissions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`inline-flex items-center gap-2 px-3 py-2 border rounded-lg text-sm font-medium transition-colors ${
              showFilters || activeFilters > 0
                ? "bg-primary text-primary-foreground border-primary"
                : "hover:bg-muted"
            }`}
          >
            <Search className="w-4 h-4" />
            Filter
            {activeFilters > 0 && (
              <span className="ml-1 bg-white text-primary rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold">
                {activeFilters}
              </span>
            )}
          </button>
          <button
            onClick={() => exportToCsv(filtered)}
            className="inline-flex items-center gap-2 px-3 py-2 border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
          >
            <Download className="w-4 h-4" /> Export
          </button>
          <button
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            <UserPlus className="w-4 h-4" /> Add Staff
          </button>
        </div>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="rounded-xl border bg-white p-4 flex flex-wrap gap-4 items-end">
          <div className="flex-1 min-w-[200px] space-y-1">
            <label className="text-xs font-semibold text-gray-600">Search</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name or email..."
                className="w-full border rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-gray-600">Role</label>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
            >
              {ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-gray-600">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "" | "active" | "inactive")}
              className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
            >
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          {activeFilters > 0 && (
            <button
              onClick={() => { setSearch(""); setRoleFilter(""); setStatusFilter(""); }}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <X size={14} /> Clear
            </button>
          )}
        </div>
      )}

      {/* Table */}
      <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="animate-pulse space-y-3 p-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 bg-muted rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 text-muted-foreground font-medium border-b">
                <tr>
                  <th className="px-6 py-3">Staff Member</th>
                  <th className="px-6 py-3">Role</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Joined</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((user) => (
                  <tr key={user.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm shrink-0">
                          {(user.firstName?.[0] ?? user.email?.[0] ?? "U").toUpperCase()}
                          {(user.lastName?.[0] ?? "").toUpperCase()}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-800">
                            {user.firstName ?? ""} {user.lastName ?? ""}
                          </div>
                          <div className="text-xs text-muted-foreground">{user.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLOR[user.role ?? ""] ?? "bg-slate-100 text-slate-600"}`}>
                        <Shield className="w-2.5 h-2.5" />
                        {ROLE_LABEL[user.role ?? ""] ?? user.role ?? "staff"}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {user.isActive ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">
                          <CheckCircle2 className="w-3 h-3" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-medium">
                          <XCircle className="w-3 h-3" /> Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-muted-foreground text-sm">
                      {user.createdAt ? format(new Date(user.createdAt), "MMM d, yyyy") : "--"}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          title="Edit"
                          onClick={() => openEdit(user)}
                          className="p-2 hover:bg-blue-50 rounded-lg transition-colors text-muted-foreground hover:text-blue-600"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          title="Leave management"
                          onClick={() => setLeaveUser(user)}
                          className="p-2 hover:bg-violet-50 rounded-lg transition-colors text-muted-foreground hover:text-violet-600"
                        >
                          <CalendarDays className="w-4 h-4" />
                        </button>
                        {confirmDeactivateId === user.id ? (
                          <span className="flex items-center gap-1">
                            <button
                              onClick={() => deactivateMutation.mutate(user.id)}
                              disabled={deactivateMutation.isPending}
                              className="text-xs text-red-600 font-semibold hover:underline disabled:opacity-60"
                            >
                              {deactivateMutation.isPending ? "..." : "Confirm"}
                            </button>
                            <button
                              onClick={() => setConfirmDeactivateId(null)}
                              className="text-xs text-muted-foreground hover:underline"
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            title="Deactivate"
                            onClick={() => setConfirmDeactivateId(user.id)}
                            className="p-2 hover:bg-red-50 rounded-lg transition-colors text-muted-foreground hover:text-red-600"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center py-16 text-muted-foreground">
                      {users.length === 0 ? "No staff members found." : "No matches for current filters."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Leave management modal */}
      {leaveUser && (
        <StaffLeaveModal
          userId={leaveUser.id}
          userName={`${leaveUser.firstName ?? ""} ${leaveUser.lastName ?? ""}`.trim() || leaveUser.email}
          open={!!leaveUser}
          onClose={() => setLeaveUser(null)}
        />
      )}

      {/* Add staff modal */}
      <Modal title="Add New Staff Member" open={open} onClose={() => setOpen(false)} size="md">
        <StaffForm onSuccess={() => setOpen(false)} onCancel={() => setOpen(false)} />
      </Modal>

      {/* Edit staff modal */}
      <Modal
        title="Edit Staff Account"
        open={!!editingUser}
        onClose={() => setEditingUser(null)}
        size="md"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!editingUser) return;
            updateMutation.mutate({ id: editingUser.id, data: editForm });
          }}
          className="space-y-4"
        >
          {/* Name row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                First Name
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input
                  type="text"
                  required
                  value={editForm.firstName}
                  onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 bg-white transition-all"
                  placeholder="John"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                Last Name
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input
                  type="text"
                  required
                  value={editForm.lastName}
                  onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 bg-white transition-all"
                  placeholder="Doe"
                />
              </div>
            </div>
          </div>

          {/* Role + Status row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                Role
              </label>
              <div className="relative">
                <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                <select
                  required
                  value={editForm.role}
                  onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 bg-white appearance-none transition-all"
                >
                  <option value="">Select role...</option>
                  {EDIT_ROLE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                Account Status
              </label>
              <select
                value={editForm.isActive ? "active" : "inactive"}
                onChange={(e) => setEditForm({ ...editForm, isActive: e.target.value === "active" })}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 bg-white transition-all"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>

          {/* Read-only email hint */}
          {editingUser?.email && (
            <p className="text-xs text-slate-400 flex items-center gap-1.5">
              <AlertCircle className="w-3 h-3" />
              Email cannot be changed: <span className="font-mono">{editingUser.email}</span>
            </p>
          )}

          {/* Actions */}
          <div className="flex gap-2.5 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setEditingUser(null)}
              className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white py-2 rounded-lg font-semibold text-sm hover:bg-blue-700 disabled:opacity-60 transition-colors shadow-sm"
            >
              {updateMutation.isPending ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving...</>
              ) : (
                "Save Changes"
              )}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
