"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Plus, Search, Edit2, Shield, Calendar, UserCheck } from "lucide-react";

interface Employee {
  id: string;
  userId: string;
  branchId: string;
  departmentId?: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  phone?: string;
  address?: string;
  hireDate: string;
  designation?: string;
  baseSalary: string;
  isActive: boolean;
}

export function EmployeesView() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [editingEmp, setEditingEmp] = useState<Employee | null>(null);

  const [form, setForm] = useState({
    userId: "",
    branchId: "",
    employeeCode: "",
    firstName: "",
    lastName: "",
    phone: "",
    hireDate: "",
    designation: "",
    baseSalary: "0",
  });

  const { data: rawEmps, isLoading } = useQuery({
    queryKey: ["employees", { search }],
    queryFn: () => apiClient.get("/hr/employees", { params: { search } }),
  });

  const { data: rawUsers } = useQuery({
    queryKey: ["users"],
    queryFn: () => apiClient.get("/users"),
  });

  const employees: Employee[] = (() => {
    const d = rawEmps as any;
    if (Array.isArray(d)) return d;
    if (Array.isArray(d?.data)) return d.data;
    if (Array.isArray(d?.data?.data)) return d.data.data;
    if (Array.isArray(d?.rows)) return d.rows;
    return [];
  })();

  const users = (() => {
    const d = rawUsers as any;
    if (Array.isArray(d)) return d;
    if (Array.isArray(d?.data)) return d.data;
    if (Array.isArray(d?.data?.data)) return d.data.data;
    if (Array.isArray(d?.rows)) return d.rows;
    return [];
  })();

  const createMutation = useMutation({
    mutationFn: (data: any) => apiClient.post("/hr/employees", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      handleClose();
    },
    onError: (err: any) => {
      alert(err?.response?.data?.message ?? "Error creating employee record");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      apiClient.patch(`/hr/employees/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      handleClose();
    },
    onError: (err: any) => {
      alert(err?.response?.data?.message ?? "Error updating employee record");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/hr/employees/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
  });

  function openCreate() {
    setEditingEmp(null);
    setForm({
      userId: users[0]?.id || "",
      branchId: users[0]?.branchId || "00000000-0000-0000-0000-000000000000",
      employeeCode: "",
      firstName: "",
      lastName: "",
      phone: "",
      hireDate: new Date().toISOString().split("T")[0] || "",
      designation: "",
      baseSalary: "0",
    });
    setIsOpen(true);
  }

  function openEdit(emp: Employee) {
    setEditingEmp(emp);
    setForm({
      userId: emp.userId ?? "",
      branchId: emp.branchId ?? "",
      employeeCode: emp.employeeCode ?? "",
      firstName: emp.firstName ?? "",
      lastName: emp.lastName ?? "",
      phone: emp.phone ?? "",
      hireDate: emp.hireDate ?? "",
      designation: emp.designation ?? "",
      baseSalary: emp.baseSalary ?? "0",
    });
    setIsOpen(true);
  }

  function handleClose() {
    setIsOpen(false);
    setEditingEmp(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.userId || !form.employeeCode || !form.firstName || !form.lastName) return;

    const payload = {
      ...form,
      hireDate: form.hireDate || new Date().toISOString().split("T")[0] || "",
    };

    if (editingEmp) {
      updateMutation.mutate({ id: editingEmp.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <input
            type="text"
            placeholder="Search employees..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border rounded-lg pl-10 pr-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
          />
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:opacity-90 shadow-sm transition-all"
        >
          <Plus className="w-4 h-4" /> Add Employee
        </button>
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-muted rounded-xl" />
          ))}
        </div>
      ) : employees.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">No employees found.</div>
      ) : (
        <div className="bg-card rounded-xl border shadow-sm overflow-hidden bg-white backdrop-blur-md bg-opacity-70">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 text-muted-foreground font-medium border-b">
                <tr>
                  <th className="px-6 py-4">Employee</th>
                  <th className="px-6 py-4">Code</th>
                  <th className="px-6 py-4">Designation</th>
                  <th className="px-6 py-4">Hire Date</th>
                  <th className="px-6 py-4">Base Salary</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {employees.map((emp) => (
                  <tr key={emp.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-4 font-semibold text-slate-800">
                      {emp.firstName} {emp.lastName}
                    </td>
                    <td className="px-6 py-4 font-mono text-xs">{emp.employeeCode}</td>
                    <td className="px-6 py-4 text-muted-foreground">
                      {emp.designation || "Staff"}
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">
                      {emp.hireDate || "--"}
                    </td>
                    <td className="px-6 py-4 font-bold text-slate-800">
                      ₹{emp.baseSalary}
                    </td>
                    <td className="px-6 py-4 text-right flex gap-2 justify-end">
                      <button
                        onClick={() => openEdit(emp)}
                        className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition-colors rounded-lg"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Are you sure you want to delete ${emp.firstName}?`)) {
                            deleteMutation.mutate(emp.id);
                          }
                        }}
                        className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors rounded-lg"
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Employee Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full border max-h-[90vh] overflow-y-auto p-6">
            <h3 className="text-lg font-bold mb-4">
              {editingEmp ? "Edit Employee" : "Create Employee Record"}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold">User Account *</label>
                  <select
                    required
                    value={form.userId}
                    onChange={(e) => setForm({ ...form, userId: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-background"
                  >
                    {users.map((u: any) => (
                      <option key={u.id} value={u.id}>
                        {u.firstName || u.email}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold">Employee Code *</label>
                  <input
                    type="text"
                    required
                    placeholder="EMP-001"
                    value={form.employeeCode}
                    onChange={(e) => setForm({ ...form, employeeCode: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-background font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold">First Name *</label>
                  <input
                    type="text"
                    required
                    value={form.firstName}
                    onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-background"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold">Last Name *</label>
                  <input
                    type="text"
                    required
                    value={form.lastName}
                    onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-background"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold">Hire Date *</label>
                  <input
                    type="date"
                    required
                    value={form.hireDate}
                    onChange={(e) => setForm({ ...form, hireDate: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-background"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold">Base Salary (₹) *</label>
                  <input
                    type="text"
                    required
                    value={form.baseSalary}
                    onChange={(e) => setForm({ ...form, baseSalary: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-background font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold">Designation</label>
                <input
                  type="text"
                  placeholder="Senior Pharmacist"
                  value={form.designation}
                  onChange={(e) => setForm({ ...form, designation: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-background"
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
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors shadow-sm"
                >
                  {createMutation.isPending || updateMutation.isPending ? "Saving..." : editingEmp ? "Update" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
