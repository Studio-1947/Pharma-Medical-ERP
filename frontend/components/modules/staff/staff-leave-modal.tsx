"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { useAuthStore } from "@/stores/auth.store";
import {
  Plus, Calendar, CheckCircle2, XCircle, Clock,
  Loader2, AlertCircle, ChevronDown, ChevronUp,
} from "lucide-react";
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
}

interface Props {
  userId: string;
  userName: string;
  open: boolean;
  onClose: () => void;
}

const LEAVE_TYPE_LABEL: Record<string, string> = {
  sick: "Sick Leave",
  casual: "Casual Leave",
  annual: "Annual Leave",
  unpaid: "Unpaid Leave",
};

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
  cancelled: "bg-slate-100 text-slate-500",
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  pending: <Clock className="w-3 h-3" />,
  approved: <CheckCircle2 className="w-3 h-3" />,
  rejected: <XCircle className="w-3 h-3" />,
  cancelled: <XCircle className="w-3 h-3" />,
};

const emptyForm = {
  leaveType: "sick",
  startDate: "",
  endDate: "",
  days: 1,
  reason: "",
};

export function StaffLeaveModal({ userId, userName, open, onClose }: Props) {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuthStore();
  const { success: toastSuccess, error: toastError } = useToast();
  const isAdmin = currentUser?.role === "admin" || currentUser?.role === "super_admin";

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);

  // Resolve employee record for this user
  const { data: rawEmps, isLoading: loadingEmp } = useQuery({
    queryKey: ["employees", { userId }],
    queryFn: () => apiClient.get("/hr/employees", { params: { userId } }),
    enabled: open,
  });

  const employees: any[] = (() => {
    const d = rawEmps as any;
    if (Array.isArray(d)) return d;
    if (Array.isArray(d?.data)) return d.data;
    if (Array.isArray(d?.data?.data)) return d.data.data;
    return [];
  })();

  const employee = employees.find((e: any) => e.userId === userId) ?? employees[0] ?? null;

  // Fetch leaves for this employee
  const { data: rawLeaves, isLoading: loadingLeaves } = useQuery({
    queryKey: ["leaves", { employeeId: employee?.id }],
    queryFn: () => apiClient.get("/hr/leaves", { params: { employeeId: employee.id } }),
    enabled: !!employee?.id && open,
  });

  const leaves: LeaveRequest[] = (() => {
    const d = rawLeaves as any;
    if (Array.isArray(d)) return d;
    if (Array.isArray(d?.data)) return d.data;
    if (Array.isArray(d?.data?.data)) return d.data.data;
    return [];
  })();

  const createMutation = useMutation({
    mutationFn: (data: any) => apiClient.post("/hr/leaves", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leaves"] });
      toastSuccess("Leave requested", "The leave application has been submitted.");
      setForm(emptyForm);
      setShowForm(false);
    },
    onError: (err: any) => {
      toastError("Failed", err?.response?.data?.message ?? "Could not submit leave request.");
    },
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiClient.patch(`/hr/leaves/${id}/review`, { status }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["leaves"] });
      toastSuccess(
        vars.status === "approved" ? "Leave approved" : "Leave rejected",
        `The request has been ${vars.status}.`
      );
    },
    onError: () => toastError("Failed", "Could not update leave status."),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/hr/leaves/${id}/review`, { status: "cancelled" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leaves"] });
      toastSuccess("Cancelled", "Leave request has been cancelled.");
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!employee?.id) return;
    createMutation.mutate({
      ...form,
      employeeId: employee.id,
      days: Number(form.days),
    });
  }

  // Auto-calculate days when dates change
  function handleDateChange(field: "startDate" | "endDate", value: string) {
    const updated = { ...form, [field]: value };
    if (updated.startDate && updated.endDate) {
      const start = new Date(updated.startDate);
      const end = new Date(updated.endDate);
      const diff = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000) + 1);
      updated.days = diff;
    }
    setForm(updated);
  }

  const pending = leaves.filter((l) => l.status === "pending").length;
  const approved = leaves.filter((l) => l.status === "approved").length;

  return (
    <Modal
      title={`${userName} — Leave Management`}
      open={open}
      onClose={onClose}
      size="lg"
    >
      {loadingEmp ? (
        <div className="flex items-center justify-center py-12 gap-2 text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading employee record...
        </div>
      ) : !employee ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
          <AlertCircle className="w-8 h-8 text-amber-400" />
          <p className="font-semibold text-slate-700">No employee record found</p>
          <p className="text-sm text-slate-400 max-w-xs">
            This staff account doesn't have a linked employee record yet. Create one under the
            "Employee Records" tab first.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Summary bar */}
          <div className="flex items-center gap-4 bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
            <div className="text-center">
              <p className="text-xl font-bold text-slate-800">{leaves.length}</p>
              <p className="text-xs text-slate-500">Total</p>
            </div>
            <div className="w-px h-8 bg-slate-200" />
            <div className="text-center">
              <p className="text-xl font-bold text-amber-600">{pending}</p>
              <p className="text-xs text-slate-500">Pending</p>
            </div>
            <div className="w-px h-8 bg-slate-200" />
            <div className="text-center">
              <p className="text-xl font-bold text-emerald-600">{approved}</p>
              <p className="text-xs text-slate-500">Approved</p>
            </div>
            <div className="ml-auto">
              <button
                onClick={() => setShowForm((v) => !v)}
                className="inline-flex items-center gap-2 bg-emerald-600 text-white px-3 py-2 rounded-lg text-sm font-semibold hover:bg-emerald-700 transition-colors shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                Apply Leave
                {showForm ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* Apply leave form (collapsible) */}
          {showForm && (
            <form
              onSubmit={handleSubmit}
              className="border border-emerald-100 bg-emerald-50/40 rounded-xl p-4 space-y-3"
            >
              <p className="text-xs font-bold text-emerald-700 uppercase tracking-wide">New Leave Request</p>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Leave Type</label>
                  <select
                    value={form.leaveType}
                    onChange={(e) => setForm({ ...form, leaveType: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  >
                    <option value="sick">Sick Leave</option>
                    <option value="casual">Casual Leave</option>
                    <option value="annual">Annual Leave</option>
                    <option value="unpaid">Unpaid Leave</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                    Duration
                  </label>
                  <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-3 py-2">
                    <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="text-sm font-semibold text-slate-700">{form.days}</span>
                    <span className="text-xs text-slate-400">day{form.days !== 1 ? "s" : ""}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Start Date</label>
                  <input
                    type="date"
                    required
                    value={form.startDate}
                    onChange={(e) => handleDateChange("startDate", e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">End Date</label>
                  <input
                    type="date"
                    required
                    value={form.endDate}
                    min={form.startDate}
                    onChange={(e) => handleDateChange("endDate", e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Reason</label>
                <textarea
                  required
                  rows={2}
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  placeholder="Brief description of the reason for leave..."
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 resize-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setForm(emptyForm); }}
                  className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="flex items-center gap-2 px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60 transition-colors shadow-sm"
                >
                  {createMutation.isPending ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Submitting...</>
                  ) : "Submit Request"}
                </button>
              </div>
            </form>
          )}

          {/* Leave history */}
          {loadingLeaves ? (
            <div className="animate-pulse space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-14 bg-muted rounded-lg" />)}
            </div>
          ) : leaves.length === 0 ? (
            <div className="text-center py-10 text-slate-400 border rounded-xl bg-white">
              No leave requests yet.
            </div>
          ) : (
            <div className="rounded-xl border bg-white overflow-hidden">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/50 text-muted-foreground text-xs font-semibold border-b">
                  <tr>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Dates</th>
                    <th className="px-4 py-3">Days</th>
                    <th className="px-4 py-3">Reason</th>
                    <th className="px-4 py-3">Status</th>
                    {isAdmin && <th className="px-4 py-3 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {leaves.map((l) => (
                    <tr key={l.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-700 whitespace-nowrap">
                        {LEAVE_TYPE_LABEL[l.leaveType] ?? l.leaveType}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                        {l.startDate}<br />to {l.endDate}
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-700 text-center">
                        {l.days}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 max-w-[160px] truncate">
                        {l.reason}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${STATUS_STYLE[l.status]}`}>
                          {STATUS_ICON[l.status]}
                          {l.status}
                        </span>
                      </td>
                      {isAdmin && (
                        <td className="px-4 py-3 text-right">
                          {l.status === "pending" && (
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => reviewMutation.mutate({ id: l.id, status: "approved" })}
                                disabled={reviewMutation.isPending}
                                className="px-2 py-1 text-xs font-semibold text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-50"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => reviewMutation.mutate({ id: l.id, status: "rejected" })}
                                disabled={reviewMutation.isPending}
                                className="px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                              >
                                Reject
                              </button>
                            </div>
                          )}
                          {l.status === "approved" && (
                            <button
                              onClick={() => cancelMutation.mutate(l.id)}
                              disabled={cancelMutation.isPending}
                              className="px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-50 rounded-lg transition-colors disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
