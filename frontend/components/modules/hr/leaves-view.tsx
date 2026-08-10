"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth.store";
import { useToast } from "@/components/ui/toast";
import { Plus, Calendar, Edit2, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";

interface LeaveRequest {
  id: string;
  employeeId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  employee?: { firstName: string; lastName: string };
}

export function LeavesView() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const { error: toastError, success: toastSuccess } = useToast();
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";

  const [isOpen, setIsOpen] = useState(false);
  const [editingLeave, setEditingLeave] = useState<LeaveRequest | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [form, setForm] = useState({
    employeeId: "",
    leaveType: "sick",
    startDate: "",
    endDate: "",
    days: 1,
    reason: "",
  });

  const { data: rawLeaves, isLoading } = useQuery({
    queryKey: ["leaves"],
    queryFn: () => apiClient.get("/hr/leaves"),
  });

  const { data: rawEmps } = useQuery({
    queryKey: ["employees"],
    queryFn: () => apiClient.get("/hr/employees"),
  });

  const leaves: LeaveRequest[] = (() => {
    const d = rawLeaves as any;
    if (Array.isArray(d)) return d;
    if (Array.isArray(d?.data)) return d.data;
    if (Array.isArray(d?.data?.data)) return d.data.data;
    if (Array.isArray(d?.rows)) return d.rows;
    return [];
  })();

  const employees = (() => {
    const d = rawEmps as any;
    if (Array.isArray(d)) return d;
    if (Array.isArray(d?.data)) return d.data;
    if (Array.isArray(d?.data?.data)) return d.data.data;
    if (Array.isArray(d?.rows)) return d.rows;
    return [];
  })();

  const createMutation = useMutation({
    mutationFn: (data: any) => apiClient.post("/hr/leaves", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leaves"] });
      handleClose();
    },
    onError: (err: any) => {
      toastError("Failed to submit leave request", err?.response?.data?.message ?? "An unexpected error occurred. Please try again.");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: object }) =>
      apiClient.patch(`/hr/leaves/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leaves"] });
      toastSuccess("Leave updated", "Leave request has been updated.");
      setEditingLeave(null);
    },
    onError: (err: any) => {
      toastError("Update failed", err?.response?.data?.message ?? "Could not update leave request.");
    },
  });

  const deleteLeaveMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/hr/leaves/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leaves"] });
      toastSuccess("Leave deleted", "Leave request has been removed.");
      setConfirmDeleteId(null);
    },
    onError: (err: any) => {
      toastError("Delete failed", err?.response?.data?.message ?? "Could not delete leave request.");
      setConfirmDeleteId(null);
    },
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, status, reviewNote }: { id: string; status: string; reviewNote?: string }) =>
      apiClient.patch(`/hr/leaves/${id}/review`, { status, reviewNote }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leaves"] });
    },
  });

  function openEdit(leave: LeaveRequest) {
    setEditingLeave(leave);
    setForm({
      employeeId: leave.employeeId,
      leaveType: leave.leaveType,
      startDate: leave.startDate,
      endDate: leave.endDate,
      days: leave.days,
      reason: leave.reason,
    });
  }

  function openCreate() {
    setForm({
      employeeId: employees[0]?.id || "",
      leaveType: "sick",
      startDate: "",
      endDate: "",
      days: 1,
      reason: "",
    });
    setIsOpen(true);
  }

  function handleClose() {
    setIsOpen(false);
    setEditingLeave(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.employeeId || !form.startDate || !form.endDate || !form.reason) return;

    const payload = { ...form, days: Number(form.days) };
    if (editingLeave) {
      updateMutation.mutate({ id: editingLeave.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-base font-semibold">Absence & Leave History</h3>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:opacity-90 shadow-sm transition-all"
        >
          <Plus className="w-4 h-4" /> Request Leave
        </button>
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-muted rounded-xl" />
          ))}
        </div>
      ) : leaves.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border rounded-xl bg-white backdrop-blur-md bg-opacity-60">
          No leave requests recorded. Click &quot;Request Leave&quot; to submit first entry.
        </div>
      ) : (
        <div className="bg-card rounded-xl border shadow-sm overflow-hidden bg-white backdrop-blur-md bg-opacity-70">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 text-muted-foreground font-medium border-b">
                <tr>
                  <th className="px-6 py-4">Employee</th>
                  <th className="px-6 py-4">Leave Type</th>
                  <th className="px-6 py-4">Dates</th>
                  <th className="px-6 py-4">Days</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {leaves.map((l) => (
                  <tr key={l.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-4 font-semibold text-slate-800">
                      {l.employee?.firstName} {l.employee?.lastName}
                    </td>
                    <td className="px-6 py-4 capitalize font-medium text-slate-700">
                      {l.leaveType}
                    </td>
                    <td className="px-6 py-4 text-muted-foreground text-xs">
                      {l.startDate} to {l.endDate}
                    </td>
                    <td className="px-6 py-4 font-medium text-slate-700">{l.days} days</td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          l.status === "pending"
                            ? "bg-amber-100 text-amber-700"
                            : l.status === "approved"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {l.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {l.status === "pending" && (
                          <>
                            <button
                              onClick={() => reviewMutation.mutate({ id: l.id, status: "approved" })}
                              className="px-2 py-1 hover:bg-emerald-50 text-emerald-600 rounded-lg transition-colors font-semibold text-xs"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => reviewMutation.mutate({ id: l.id, status: "rejected" })}
                              className="px-2 py-1 hover:bg-red-50 text-red-600 rounded-lg transition-colors font-semibold text-xs"
                            >
                              Reject
                            </button>
                            <button
                              onClick={() => { openEdit(l); setIsOpen(true); }}
                              className="p-1.5 hover:bg-muted rounded-lg transition-colors text-muted-foreground hover:text-primary"
                              title="Edit leave request"
                            >
                              <Edit2 size={14} />
                            </button>
                          </>
                        )}
                        {isAdmin && (
                          confirmDeleteId === l.id ? (
                            <span className="flex items-center gap-1">
                              <button
                                onClick={() => deleteLeaveMutation.mutate(l.id)}
                                disabled={deleteLeaveMutation.isPending}
                                className="text-xs text-red-600 font-semibold hover:underline disabled:opacity-60"
                              >
                                {deleteLeaveMutation.isPending ? "..." : "Confirm"}
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
                              onClick={() => setConfirmDeleteId(l.id)}
                              className="p-1.5 hover:bg-red-50 rounded-lg transition-colors text-muted-foreground hover:text-red-600"
                              title="Delete leave"
                            >
                              <Trash2 size={14} />
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
      )}

      {/* Draft Leave Modal */}
      <Modal
        title={editingLeave ? "Edit Leave Request" : "Request Absence/Leave"}
        subtitle={editingLeave ? `Editing leave request` : "Fill in the details to submit a leave request"}
        open={isOpen}
        onClose={handleClose}
        size="md"
        icon={<Calendar size={16} />}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-semibold">Employee *</label>
            <select
              required
              value={form.employeeId}
              onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none"
            >
              {employees.map((e: any) => (
                <option key={e.id} value={e.id}>
                  {e.firstName} {e.lastName} ({e.employeeCode})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold">Leave Type *</label>
            <select
              required
              value={form.leaveType}
              onChange={(e) => setForm({ ...form, leaveType: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none"
            >
              <option value="sick">Sick Leave</option>
              <option value="casual">Casual Leave</option>
              <option value="annual">Annual Leave</option>
              <option value="unpaid">Unpaid Leave</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold">Start Date *</label>
              <input
                type="date"
                required
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm bg-background"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold">End Date *</label>
              <input
                type="date"
                required
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm bg-background"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold">Number of Days *</label>
            <input
              type="number"
              required
              min={1}
              value={form.days}
              onChange={(e) => setForm({ ...form, days: Number(e.target.value) })}
              className="w-full border rounded-lg px-3 py-2 text-sm bg-background font-mono"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold">Reason *</label>
            <textarea
              required
              rows={2}
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="Details/Note regarding this request"
              className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-3">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 border rounded-lg text-sm font-semibold hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 transition-colors shadow-sm"
            >
              {createMutation.isPending ? "Submitting..." : "Submit"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
