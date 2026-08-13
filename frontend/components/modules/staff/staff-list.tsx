"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, queryKeys } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth.store";
import { useToast } from "@/components/ui/toast";
import { UserDto, UserRole } from "@pharmerp/types";
import {
  Edit2,
  Trash2,
  CheckCircle2,
  XCircle,
  Shield
} from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";
import { Modal } from "@/components/ui/modal";

const ROLE_OPTIONS: UserRole[] = [
  "admin" as UserRole,
  "shop_manager" as UserRole,
  "doctor" as UserRole,
  "super_admin" as UserRole,
];

export function StaffList() {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuthStore();
  const { success: toastSuccess, error: toastError } = useToast();
  const isAdmin = currentUser?.role === "admin" || currentUser?.role === "super_admin";

  const [editingUser, setEditingUser] = useState<UserDto | null>(null);
  const [editForm, setEditForm] = useState({ firstName: "", lastName: "", role: "" as UserRole, isActive: true });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const { data: rawUsers, isLoading } = useQuery({
    queryKey: queryKeys.users.all(),
    queryFn: () => apiClient.get("/users"),
  });

  const users = (Array.isArray(rawUsers) ? rawUsers : (rawUsers as any)?.data ?? []) as UserDto[];

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: object }) =>
      apiClient.patch(`/users/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all() });
      toastSuccess("Staff updated", "Staff member details have been saved.");
      setEditingUser(null);
    },
    onError: (err: any) => {
      toastError("Update failed", err?.response?.data?.message ?? "Could not update staff member.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/users/${id}/deactivate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all() });
      toastSuccess("Staff removed", "Staff member has been deleted.");
      setConfirmDeleteId(null);
    },
    onError: (err: any) => {
      toastError("Delete failed", err?.response?.data?.message ?? "Could not delete staff member.");
      setConfirmDeleteId(null);
    },
  });

  function openEdit(user: UserDto) {
    setEditingUser(user);
    setEditForm({
      firstName: user.firstName ?? "",
      lastName: user.lastName ?? "",
      role: user.role as UserRole,
      isActive: user.isActive ?? true,
    });
  }

  if (isLoading) {
    return <div className="animate-pulse space-y-4">
      {[1, 2, 3].map(i => (
        <div key={i} className="h-16 bg-muted rounded-xl" />
      ))}
    </div>;
  }

  return (
    <>
    <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted/50 text-muted-foreground font-medium border-b">
            <tr>
              <th className="px-6 py-4">Staff Member</th>
              <th className="px-6 py-4">Role</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4">Joined</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm">
                      {(user.firstName?.[0] ?? user.email?.[0] ?? "U").toUpperCase()}
                      {(user.lastName?.[0] ?? "").toUpperCase()}
                    </div>
                    <div>
                      <div className="font-semibold">{user.firstName ?? "User"} {user.lastName ?? ""}</div>
                      <div className="text-xs text-muted-foreground">{user.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-emerald-500" />
                    <span className="capitalize">{(user.role ?? "staff").toString().replace('_', ' ')}</span>
                  </div>
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
                <td className="px-6 py-4 text-muted-foreground">
                  {format(new Date(user.createdAt), "MMM d, yyyy")}
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-1 items-center">
                    <button
                      onClick={() => openEdit(user)}
                      className="p-2 hover:bg-muted rounded-lg transition-colors text-muted-foreground hover:text-primary"
                      title="Edit staff member"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    {isAdmin && (
                      confirmDeleteId === user.id ? (
                        <span className="flex items-center gap-1">
                          <button
                            onClick={() => deleteMutation.mutate(user.id)}
                            disabled={deleteMutation.isPending}
                            className="text-xs text-red-600 font-semibold hover:underline disabled:opacity-60"
                          >
                            {deleteMutation.isPending ? "..." : "Confirm"}
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="text-xs text-muted-foreground hover:underline"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(user.id)}
                          className="p-2 hover:bg-red-50 rounded-lg transition-colors text-muted-foreground hover:text-red-600"
                          title="Delete staff member"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>

      {/* Edit Staff Modal */}
      <Modal
        title="Edit Staff Member"
        subtitle={editingUser ? `Editing user: ${editingUser.email}` : undefined}
        open={!!editingUser}
        onClose={() => setEditingUser(null)}
        size="md"
        icon={<Shield size={16} />}
      >
        {editingUser && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold">First Name</label>
                <input
                  type="text"
                  value={editForm.firstName}
                  onChange={(e) => setEditForm((f) => ({ ...f, firstName: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold">Last Name</label>
                <input
                  type="text"
                  value={editForm.lastName}
                  onChange={(e) => setEditForm((f) => ({ ...f, lastName: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold">Role</label>
              <select
                value={editForm.role}
                onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value as UserRole }))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>{r.replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="staff-active"
                type="checkbox"
                checked={editForm.isActive}
                onChange={(e) => setEditForm((f) => ({ ...f, isActive: e.target.checked }))}
                className="w-4 h-4 rounded border-gray-300 text-primary"
              />
              <label htmlFor="staff-active" className="text-sm select-none cursor-pointer">Active account</label>
            </div>

            <div className="flex justify-end gap-3 mt-5">
              <button
                onClick={() => setEditingUser(null)}
                className="px-4 py-2 border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  updateMutation.mutate({
                    id: editingUser.id,
                    data: {
                      firstName: editForm.firstName,
                      lastName: editForm.lastName,
                      role: editForm.role,
                      isActive: editForm.isActive,
                    },
                  })
                }
                disabled={updateMutation.isPending}
                className="px-5 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 disabled:opacity-60 transition-colors"
              >
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
