"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, queryKeys } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth.store";
import { useToast } from "@/components/ui/toast";
import { UserPlus, Search, Edit2, Trash2, Phone, Calendar, Star, Eye } from "lucide-react";
import { format } from "date-fns";
import { Modal } from "@/components/ui/modal";

interface Patient {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  gender?: string | null;
  bloodGroup?: string | null;
  allergies?: string[] | null;
  loyaltyPoints: number;
  outstandingBalance: string;
  isActive: boolean;
  createdAt: string;
}

interface PatientFormData {
  name: string;
  phone: string;
  email: string;
  dateOfBirth: string;
  gender: string;
  address: string;
  state: string;
  bloodGroup: string;
}

const emptyForm: PatientFormData = {
  name: "",
  phone: "",
  email: "",
  dateOfBirth: "",
  gender: "",
  address: "",
  state: "",
  bloodGroup: "",
};

const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

const inputCls =
  "w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition placeholder:text-slate-400";

const labelCls = "block text-xs font-semibold text-slate-600 mb-1";

function PatientHistoryModal({ patient, onClose }: { patient: Patient | null; onClose: () => void }) {
  const { data: invoicesRes, isLoading: loadingInvoices } = useQuery({
    queryKey: ["patient-invoices", patient?.id],
    queryFn: () => apiClient.get("/billing/invoices", { params: { patientId: patient!.id, limit: 10 } }),
    enabled: !!patient,
  });

  if (!patient) return null;

  const invoices: any[] = (invoicesRes as any)?.data ?? [];

  return (
    <Modal
      title={`Patient Profile — ${patient.name}`}
      subtitle={`Phone: ${patient.phone} • Loyalty Points: ${patient.loyaltyPoints ?? 0}`}
      open={!!patient}
      onClose={onClose}
      size="lg"
    >
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
          <div>
            <span className="text-slate-400 block font-semibold uppercase">Blood Group</span>
            <span className="font-bold text-slate-800">{patient.bloodGroup ?? "N/A"}</span>
          </div>
          <div>
            <span className="text-slate-400 block font-semibold uppercase">Gender</span>
            <span className="font-bold text-slate-800 capitalize">{patient.gender ?? "N/A"}</span>
          </div>
          <div>
            <span className="text-slate-400 block font-semibold uppercase">Loyalty Balance</span>
            <span className="font-bold text-yellow-700">{patient.loyaltyPoints ?? 0} pts</span>
          </div>
          <div>
            <span className="text-slate-400 block font-semibold uppercase">Outstanding</span>
            <span className="font-bold text-slate-800">₹{parseFloat(patient.outstandingBalance ?? "0").toFixed(2)}</span>
          </div>
        </div>

        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Dispensing & Billing History</h4>
          {loadingInvoices ? (
            <p className="text-xs text-slate-400 py-4 text-center">Loading sales history...</p>
          ) : invoices.length === 0 ? (
            <p className="text-xs text-slate-400 py-4 text-center">No dispensing history for this patient.</p>
          ) : (
            <div className="border rounded-xl overflow-hidden max-h-48 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500 font-semibold border-b">
                  <tr>
                    <th className="px-3 py-2 text-left">Invoice #</th>
                    <th className="px-3 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {invoices.map((inv: any) => (
                    <tr key={inv.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono font-semibold text-emerald-600">{inv.invoiceNo}</td>
                      <td className="px-3 py-2 text-slate-600">{inv.createdAt ? format(new Date(inv.createdAt), "dd MMM yyyy") : "--"}</td>
                      <td className="px-3 py-2 text-right font-bold text-slate-800">₹{parseFloat(inv.totalAmount).toFixed(2)}</td>
                      <td className="px-3 py-2 text-center capitalize">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${inv.status === "paid" || inv.status === "confirmed" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                          {inv.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function PatientsClient() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const { success: toastSuccess, error: toastError } = useToast();
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [historyTarget, setHistoryTarget] = useState<Patient | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [isOpen, setIsOpen] = useState(false);
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null);
  const [form, setForm] = useState<PatientFormData>(emptyForm);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const queryParams = { search: debouncedSearch, page, limit: 20 };

  const { data: rawData, isLoading } = useQuery({
    queryKey: queryKeys.patients.list(queryParams),
    queryFn: () => apiClient.get("/patients", { params: queryParams }),
  });

  const patients: Patient[] = (() => {
    const d = rawData as any;
    if (Array.isArray(d)) return d;
    if (Array.isArray(d?.data)) return d.data;
    if (Array.isArray(d?.data?.data)) return d.data.data;
    return [];
  })();

  const meta = (() => {
    const d = rawData as any;
    return d?.meta ?? d?.data?.meta ?? null;
  })();

  const createMutation = useMutation({
    mutationFn: (data: object) => apiClient.post("/patients", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.patients.all() });
      handleClose();
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.message ?? "Failed to save patient.");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: object }) =>
      apiClient.patch(`/patients/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.patients.all() });
      handleClose();
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.message ?? "Failed to update patient.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/patients/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.patients.all() });
      toastSuccess("Patient deleted", "Patient record has been permanently removed.");
      setConfirmDeleteId(null);
    },
    onError: (err: any) => {
      toastError("Delete failed", err?.response?.data?.message ?? "Could not delete this patient.");
      setConfirmDeleteId(null);
    },
  });

  function openCreate() {
    setEditingPatient(null);
    setForm(emptyForm);
    setFormError("");
    setIsOpen(true);
  }

  function openEdit(patient: Patient) {
    setEditingPatient(patient);
    setForm({
      name: patient.name ?? "",
      phone: patient.phone ?? "",
      email: patient.email ?? "",
      dateOfBirth: "",
      gender: patient.gender ?? "",
      address: "",
      state: "",
      bloodGroup: patient.bloodGroup ?? "",
    });
    setFormError("");
    setIsOpen(true);
  }

  function handleClose() {
    setIsOpen(false);
    setEditingPatient(null);
    setForm(emptyForm);
    setFormError("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    if (!form.name.trim() || !form.phone.trim()) {
      setFormError("Name and phone are required.");
      return;
    }
    const payload: Record<string, any> = {
      name: form.name.trim(),
      phone: form.phone.trim(),
    };
    if (form.email.trim()) payload.email = form.email.trim();
    if (form.dateOfBirth) payload.dateOfBirth = new Date(form.dateOfBirth).toISOString();
    if (form.gender) payload.gender = form.gender;
    if (form.address.trim()) payload.address = form.address.trim();
    if (form.state.trim()) payload.state = form.state.trim();
    if (form.bloodGroup) payload.bloodGroup = form.bloodGroup;

    if (editingPatient) {
      updateMutation.mutate({ id: editingPatient.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Patients</h1>
          <p className="text-muted-foreground mt-1">Manage registered patients and their records.</p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity"
        >
          <UserPlus className="w-4 h-4" /> Register Patient
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search by name or phone..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-muted rounded-xl" />)}
        </div>
      ) : patients.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <UserPlus className="mx-auto mb-3 opacity-30" size={48} />
          <p className="font-medium">No patients registered yet.</p>
          <p className="text-sm mt-1">Click &quot;Register Patient&quot; to add the first patient.</p>
        </div>
      ) : (
        <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 text-muted-foreground font-medium border-b">
                <tr>
                  <th className="px-6 py-4">Patient</th>
                  <th className="px-6 py-4">Phone</th>
                  <th className="px-6 py-4">Gender</th>
                  <th className="px-6 py-4">Blood Group</th>
                  <th className="px-6 py-4">Loyalty</th>
                  <th className="px-6 py-4">Registered</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {patients.map((patient) => (
                  <tr key={patient.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm shrink-0">
                          {(patient.name?.[0] ?? "P").toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium">{patient.name}</p>
                          {patient.email && <p className="text-xs text-muted-foreground">{patient.email}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Phone className="w-3.5 h-3.5" />{patient.phone}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground capitalize">{patient.gender ?? "--"}</td>
                    <td className="px-6 py-4">
                      {patient.bloodGroup ? (
                        <span className="bg-red-50 text-red-700 border border-red-100 text-xs font-bold px-2 py-0.5 rounded">{patient.bloodGroup}</span>
                      ) : <span className="text-muted-foreground">--</span>}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1 text-yellow-700 font-medium text-sm">
                        <Star className="w-3.5 h-3.5" />{patient.loyaltyPoints ?? 0}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5" />
                        {patient.createdAt ? format(new Date(patient.createdAt), "MMM d, yyyy") : "--"}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setHistoryTarget(patient)}
                          className="p-2 hover:bg-muted rounded-lg transition-colors text-muted-foreground hover:text-emerald-600"
                          title="View patient dispensing history"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => openEdit(patient)}
                          className="p-2 hover:bg-muted rounded-lg transition-colors text-muted-foreground hover:text-primary"
                          title="Edit patient"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        {isAdmin && (
                          confirmDeleteId === patient.id ? (
                            <span className="flex items-center gap-1 ml-1">
                              <button
                                onClick={() => deleteMutation.mutate(patient.id)}
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
                              onClick={() => setConfirmDeleteId(patient.id)}
                              className="p-2 hover:bg-red-50 rounded-lg transition-colors text-muted-foreground hover:text-red-600"
                              title="Delete patient"
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
          <div className="flex items-center justify-between px-6 py-4 border-t text-sm text-muted-foreground">
            <span>
              {meta?.total ?? patients.length} total &bull; page {meta?.page ?? page} of {meta?.totalPages ?? "?"}
            </span>
            <div className="flex gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 border rounded-lg hover:bg-muted transition-colors disabled:opacity-40">Previous</button>
              <button onClick={() => setPage((p) => p + 1)} disabled={patients.length < 20 || page >= (meta?.totalPages ?? 1)} className="px-3 py-1 border rounded-lg hover:bg-muted transition-colors disabled:opacity-40">Next</button>
            </div>
          </div>
        </div>
      )}

      {/* Register / Edit Modal */}
      <Modal
        title={editingPatient ? "Edit Patient" : "Register Patient"}
        subtitle={editingPatient ? "Update patient details below." : "Fill in the patient's details to register them."}
        open={isOpen}
        onClose={handleClose}
        size="md"
      >
        <form onSubmit={handleSubmit} className="flex flex-col h-full">
          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {formError && (
              <div className="px-3 py-2.5 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">
                {formError}
              </div>
            )}

            {/* Contact info */}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-3">Contact Information</p>
              <div className="space-y-3">
                <div>
                  <label className={labelCls}>Full Name <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Ramesh Kumar"
                    className={inputCls}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Phone <span className="text-red-500">*</span></label>
                    <input
                      type="tel"
                      value={form.phone}
                      onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                      placeholder="+91 9876543210"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Email</label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                      placeholder="email@example.com"
                      className={inputCls}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100" />

            {/* Personal info */}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-3">Personal Details</p>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Gender</label>
                    <select
                      value={form.gender}
                      onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value }))}
                      className={inputCls}
                    >
                      <option value="">Select gender</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Date of Birth</label>
                    <input
                      type="date"
                      value={form.dateOfBirth}
                      onChange={(e) => setForm((f) => ({ ...f, dateOfBirth: e.target.value }))}
                      max={new Date().toISOString().split("T")[0]}
                      className={inputCls}
                    />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Blood Group</label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {BLOOD_GROUPS.map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, bloodGroup: f.bloodGroup === g ? "" : g }))}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                          form.bloodGroup === g
                            ? "bg-red-600 text-white border-red-600 shadow-sm"
                            : "bg-white text-slate-600 border-slate-200 hover:border-red-300 hover:text-red-600"
                        }`}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100" />

            {/* Address */}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-3">Address</p>
              <div className="space-y-3">
                <div>
                  <label className={labelCls}>Street / City</label>
                  <input
                    type="text"
                    value={form.address}
                    onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                    placeholder="e.g. 12 Park Street, Kolkata"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>State</label>
                  <input
                    type="text"
                    value={form.state}
                    onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
                    placeholder="e.g. West Bengal"
                    className={inputCls}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Sticky footer */}
          <div className="shrink-0 flex justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/60">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60 min-w-[130px]"
            >
              {isSaving ? "Saving..." : editingPatient ? "Update Patient" : "Register Patient"}
            </button>
          </div>
        </form>
      </Modal>

      <PatientHistoryModal patient={historyTarget} onClose={() => setHistoryTarget(null)} />
    </div>
  );
}
