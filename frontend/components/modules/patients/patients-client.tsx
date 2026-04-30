"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, queryKeys } from "@/lib/api-client";
import { UserPlus, Search, Edit2, MapPin, Phone, Calendar } from "lucide-react";
import { format } from "date-fns";
import { Modal } from "@/components/ui/modal";

interface Patient {
  id: string;
  name: string;
  phone: string;
  age?: number;
  address?: string;
  state?: string;
  createdAt: string;
}

interface PatientFormData {
  name: string;
  phone: string;
  age: string;
  address: string;
  state: string;
}

const emptyForm: PatientFormData = {
  name: "",
  phone: "",
  age: "",
  address: "",
  state: "",
};

export function PatientsClient() {
  const queryClient = useQueryClient();
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
      age: patient.age != null ? String(patient.age) : "",
      address: patient.address ?? "",
      state: patient.state ?? "",
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
    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      age: form.age ? Number(form.age) : undefined,
      address: form.address.trim() || undefined,
      state: form.state.trim() || undefined,
    };
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
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-muted rounded-xl" />
          ))}
        </div>
      ) : patients.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <UserPlus className="mx-auto mb-3 opacity-30" size={48} />
          <p className="font-medium">No patients registered yet.</p>
          <p className="text-sm mt-1">Click "Register Patient" to add the first patient.</p>
        </div>
      ) : (
        <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 text-muted-foreground font-medium border-b">
                <tr>
                  <th className="px-6 py-4">Patient</th>
                  <th className="px-6 py-4">Phone</th>
                  <th className="px-6 py-4">Age</th>
                  <th className="px-6 py-4">Address</th>
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
                        <span className="font-medium">{patient.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Phone className="w-3.5 h-3.5" />
                        {patient.phone}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">
                      {patient.age != null ? `${patient.age} yrs` : "--"}
                    </td>
                    <td className="px-6 py-4">
                      {patient.address ? (
                        <div className="flex items-center gap-1.5 text-muted-foreground max-w-[200px] truncate">
                          <MapPin className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{patient.address}{patient.state ? `, ${patient.state}` : ""}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">--</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5" />
                        {patient.createdAt
                          ? format(new Date(patient.createdAt), "MMM d, yyyy")
                          : "--"}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => openEdit(patient)}
                        className="p-2 hover:bg-muted rounded-lg transition-colors text-muted-foreground hover:text-primary"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination controls */}
          <div className="flex items-center justify-between px-6 py-4 border-t text-sm text-muted-foreground">
            <span>Page {page}</span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 border rounded-lg hover:bg-muted transition-colors disabled:opacity-40"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={patients.length < 20}
                className="px-3 py-1 border rounded-lg hover:bg-muted transition-colors disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Register / Edit Modal */}
      <Modal
        title={editingPatient ? "Edit Patient" : "Register Patient"}
        open={isOpen}
        onClose={handleClose}
        size="md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <div className="px-3 py-2 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">
              {formError}
            </div>
          )}
          <div className="space-y-1">
            <label className="text-sm font-medium">Full Name <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Patient full name"
              className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Phone Number <span className="text-red-500">*</span></label>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="+91 9876543210"
              className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Age</label>
            <input
              type="number"
              min={0}
              max={150}
              value={form.age}
              onChange={(e) => setForm((f) => ({ ...f, age: e.target.value }))}
              placeholder="Age in years"
              className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Address</label>
            <input
              type="text"
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              placeholder="Street, City"
              className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">State</label>
            <input
              type="text"
              value={form.state}
              onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
              placeholder="State"
              className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60"
            >
              {isSaving ? "Saving..." : editingPatient ? "Update Patient" : "Register Patient"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
