"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, queryKeys } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth.store";
import { useToast } from "@/components/ui/toast";
import {
  FileText, CheckCircle2, XCircle, Clock, AlertTriangle, Plus, Trash2, Search, Edit2,
} from "lucide-react";
import { format } from "date-fns";
import { Modal } from "@/components/ui/modal";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PrescriptionPatient { name: string; phone: string; }

interface Prescription {
  id: string;
  patientId: string;
  patient?: PrescriptionPatient;
  doctorName: string;
  hospitalName?: string;
  issuedDate: string;
  expiryDate?: string;
  status: string;
  isControlled?: boolean;
  notes?: string;
  createdAt: string;
}

interface RxItem {
  medicineName: string;
  dosage: string;
  frequency: string;
  duration: string;
  quantityPrescribed: number | "";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type TabKey = "all" | "pending_verification" | "verified" | "rejected";

const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending_verification", label: "Pending Verification" },
  { key: "verified", label: "Verified" },
  { key: "rejected", label: "Rejected" },
];

function statusBadge(status: string) {
  switch (status) {
    case "pending_verification":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 text-xs font-medium">
          <Clock className="w-3 h-3" /> Pending
        </span>
      );
    case "verified":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">
          <CheckCircle2 className="w-3 h-3" /> Verified
        </span>
      );
    case "partially_dispensed":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
          Partially Dispensed
        </span>
      );
    case "fully_dispensed":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
          Fully Dispensed
        </span>
      );
    case "rejected":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-medium">
          <XCircle className="w-3 h-3" /> Rejected
        </span>
      );
    case "expired":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-600 text-xs font-medium">
          <AlertTriangle className="w-3 h-3" /> Expired
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs font-medium">
          {status}
        </span>
      );
  }
}

function blankItem(): RxItem {
  return { medicineName: "", dosage: "", frequency: "", duration: "", quantityPrescribed: "" };
}

// ─── Create Prescription Form ─────────────────────────────────────────────────

function CreatePrescriptionModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [patientSearch, setPatientSearch] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<{ id: string; name: string; phone: string } | null>(null);
  const [showPatientDropdown, setShowPatientDropdown] = useState(false);
  const [doctorName, setDoctorName] = useState("");
  const [doctorRegNo, setDoctorRegNo] = useState("");
  const [hospitalName, setHospitalName] = useState("");
  const [issuedDate, setIssuedDate] = useState(new Date().toISOString().split("T")[0]);
  const [expiryDate, setExpiryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [isControlled, setIsControlled] = useState(false);
  const [items, setItems] = useState<RxItem[]>([blankItem()]);
  const [formError, setFormError] = useState<string | null>(null);

  const { data: patientResults } = useQuery({
    queryKey: ["patient-search", patientSearch],
    queryFn: () =>
      apiClient.get("/patients", { params: { search: patientSearch, limit: 10 } }) as Promise<any>,
    enabled: patientSearch.length >= 2,
  });

  const patients: any[] = (patientResults as any)?.data ?? [];

  const mutation = useMutation({
    mutationFn: (body: object) => apiClient.post("/prescriptions", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.prescriptions.all() });
      handleClose();
    },
    onError: (err: any) =>
      setFormError(err?.response?.data?.message ?? "Failed to create prescription."),
  });

  function handleClose() {
    setPatientSearch("");
    setSelectedPatient(null);
    setDoctorName("");
    setDoctorRegNo("");
    setHospitalName("");
    setIssuedDate(new Date().toISOString().split("T")[0]);
    setExpiryDate("");
    setNotes("");
    setIsControlled(false);
    setItems([blankItem()]);
    setFormError(null);
    onClose();
  }

  function handleItemChange(idx: number, field: keyof RxItem, value: string | number) {
    setItems((prev) => prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item)));
  }

  function addItem() { setItems((prev) => [...prev, blankItem()]); }
  function removeItem(idx: number) { setItems((prev) => prev.filter((_, i) => i !== idx)); }

  function handleSubmit() {
    if (!selectedPatient) { setFormError("Please select a patient."); return; }
    if (!doctorName.trim()) { setFormError("Doctor name is required."); return; }
    if (!issuedDate) { setFormError("Issue date is required."); return; }
    if (!expiryDate) { setFormError("Expiry date is required."); return; }
    setFormError(null);

    const rxItems = items
      .filter((i) => i.medicineName.trim())
      .map((i) => ({
        medicineName: i.medicineName.trim(),
        dosage: i.dosage || undefined,
        frequency: i.frequency || undefined,
        duration: i.duration || undefined,
        quantityPrescribed: i.quantityPrescribed !== "" ? Number(i.quantityPrescribed) : undefined,
      }));

    mutation.mutate({
      patientId: selectedPatient.id,
      doctorName: doctorName.trim(),
      doctorRegNo: doctorRegNo.trim() || undefined,
      hospitalName: hospitalName.trim() || undefined,
      issuedDate,
      expiryDate,
      notes: notes.trim() || undefined,
      isControlled,
      items: rxItems.length > 0 ? rxItems : undefined,
    });
  }

  return (
    <Modal
      title="New Prescription"
      subtitle="Register a new patient prescription"
      icon={<FileText size={16} />}
      open={open}
      onClose={handleClose}
      size="xl"
    >
      <div className="px-6 py-5 space-y-5">
        {/* Patient search */}
        <div className="space-y-1">
          <label className="text-sm font-medium">Patient <span className="text-red-500">*</span></label>
          {selectedPatient ? (
            <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              <div>
                <span className="font-medium text-sm">{selectedPatient.name}</span>
                <span className="text-muted-foreground text-xs ml-2">{selectedPatient.phone}</span>
              </div>
              <button
                onClick={() => { setSelectedPatient(null); setPatientSearch(""); }}
                className="text-xs text-red-500 hover:underline"
              >
                Change
              </button>
            </div>
          ) : (
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search by name or phone..."
                value={patientSearch}
                onChange={(e) => { setPatientSearch(e.target.value); setShowPatientDropdown(true); }}
                onFocus={() => setShowPatientDropdown(true)}
                className="w-full border rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              {showPatientDropdown && patients.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {patients.map((p: any) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setSelectedPatient({ id: p.id, name: `${p.firstName} ${p.lastName}`, phone: p.phone });
                        setShowPatientDropdown(false);
                        setPatientSearch("");
                      }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors flex items-center justify-between"
                    >
                      <span className="font-medium">{p.firstName} {p.lastName}</span>
                      <span className="text-muted-foreground text-xs">{p.phone}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Doctor + Hospital */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Doctor Name <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={doctorName}
              onChange={(e) => setDoctorName(e.target.value)}
              placeholder="Dr. Name"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Doctor Reg. No.</label>
            <input
              type="text"
              value={doctorRegNo}
              onChange={(e) => setDoctorRegNo(e.target.value)}
              placeholder="MCI Registration No."
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">Hospital / Clinic Name</label>
          <input
            type="text"
            value={hospitalName}
            onChange={(e) => setHospitalName(e.target.value)}
            placeholder="Apollo Hospitals, City Clinic..."
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        {/* Dates */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Issue Date <span className="text-red-500">*</span></label>
            <input
              type="date"
              value={issuedDate}
              onChange={(e) => setIssuedDate(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Expiry Date <span className="text-red-500">*</span></label>
            <input
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        {/* Notes + controlled flag */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-2 space-y-1">
            <label className="text-sm font-medium">Notes</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes..."
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
          </div>
          <div className="flex items-center gap-2 pt-5">
            <input
              id="is-controlled"
              type="checkbox"
              checked={isControlled}
              onChange={(e) => setIsControlled(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <label htmlFor="is-controlled" className="text-sm font-medium select-none cursor-pointer">
              Controlled Drug
              <span className="block text-xs text-muted-foreground font-normal">Schedule H / H1 / X</span>
            </label>
          </div>
        </div>

        {/* Items */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Prescribed Medicines</label>
            <button
              onClick={addItem}
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <Plus size={12} /> Add Medicine
            </button>
          </div>
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground text-xs">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Medicine</th>
                  <th className="text-left px-3 py-2 font-medium">Dosage</th>
                  <th className="text-left px-3 py-2 font-medium">Frequency</th>
                  <th className="text-left px-3 py-2 font-medium">Duration</th>
                  <th className="text-left px-3 py-2 font-medium w-20">Qty</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((item, idx) => (
                  <tr key={idx}>
                    <td className="px-2 py-1.5">
                      <input
                        type="text"
                        value={item.medicineName}
                        onChange={(e) => handleItemChange(idx, "medicineName", e.target.value)}
                        placeholder="Medicine name"
                        className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="text"
                        value={item.dosage}
                        onChange={(e) => handleItemChange(idx, "dosage", e.target.value)}
                        placeholder="500mg"
                        className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="text"
                        value={item.frequency}
                        onChange={(e) => handleItemChange(idx, "frequency", e.target.value)}
                        placeholder="BD / TDS"
                        className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="text"
                        value={item.duration}
                        onChange={(e) => handleItemChange(idx, "duration", e.target.value)}
                        placeholder="5 days"
                        className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        min={1}
                        value={item.quantityPrescribed}
                        onChange={(e) =>
                          handleItemChange(idx, "quantityPrescribed", e.target.value === "" ? "" : Number(e.target.value))
                        }
                        placeholder="10"
                        className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </td>
                    <td className="px-1">
                      <button
                        onClick={() => removeItem(idx)}
                        disabled={items.length === 1}
                        className="p-1 text-slate-400 hover:text-red-500 disabled:opacity-30 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {formError && (
          <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertTriangle size={14} /> {formError}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={handleClose}
            className="px-4 py-2 border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={mutation.isPending}
            className="flex items-center gap-2 px-5 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {mutation.isPending ? (
              <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving...</>
            ) : (
              <><FileText size={14} /> Create Prescription</>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Edit Prescription Modal ──────────────────────────────────────────────────

function EditPrescriptionModal({
  prescription,
  onClose,
}: {
  prescription: Prescription;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [doctorName, setDoctorName] = useState(prescription.doctorName);
  const [hospitalName, setHospitalName] = useState(prescription.hospitalName ?? "");
  const [issuedDate, setIssuedDate] = useState(prescription.issuedDate?.split("T")[0] ?? "");
  const [expiryDate, setExpiryDate] = useState(prescription.expiryDate?.split("T")[0] ?? "");
  const [notes, setNotes] = useState(prescription.notes ?? "");
  const [isControlled, setIsControlled] = useState(prescription.isControlled ?? false);
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: object) => apiClient.patch(`/prescriptions/${prescription.id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.prescriptions.all() });
      onClose();
    },
    onError: (err: any) =>
      setFormError(err?.response?.data?.message ?? "Failed to update prescription."),
  });

  function handleSubmit() {
    if (!doctorName.trim()) { setFormError("Doctor name is required."); return; }
    if (!issuedDate) { setFormError("Issue date is required."); return; }
    if (!expiryDate) { setFormError("Expiry date is required."); return; }
    setFormError(null);
    mutation.mutate({
      doctorName: doctorName.trim(),
      hospitalName: hospitalName.trim() || undefined,
      issuedDate,
      expiryDate,
      notes: notes.trim() || undefined,
      isControlled,
    });
  }

  return (
    <Modal
      title="Edit Prescription"
      subtitle={`Editing prescription for ${prescription.patient?.name ?? "patient"}`}
      icon={<Edit2 size={16} />}
      open
      onClose={onClose}
      size="md"
    >
      <div className="px-6 py-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Doctor Name <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={doctorName}
              onChange={(e) => setDoctorName(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Hospital / Clinic</label>
            <input
              type="text"
              value={hospitalName}
              onChange={(e) => setHospitalName(e.target.value)}
              placeholder="Apollo Hospitals..."
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Issue Date <span className="text-red-500">*</span></label>
            <input
              type="date"
              value={issuedDate}
              onChange={(e) => setIssuedDate(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Expiry Date <span className="text-red-500">*</span></label>
            <input
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">Notes</label>
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Additional notes..."
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            id="edit-controlled"
            type="checkbox"
            checked={isControlled}
            onChange={(e) => setIsControlled(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
          />
          <label htmlFor="edit-controlled" className="text-sm font-medium select-none cursor-pointer">
            Controlled Drug
            <span className="block text-xs text-muted-foreground font-normal">Schedule H / H1 / X</span>
          </label>
        </div>

        {formError && (
          <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertTriangle size={14} /> {formError}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="px-4 py-2 border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={mutation.isPending}
            className="flex items-center gap-2 px-5 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {mutation.isPending ? (
              <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving...</>
            ) : "Save Changes"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function PrescriptionsClient() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const { success: toastSuccess, error: toastError } = useToast();
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";

  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [page, setPage] = useState(1);
  const [verifyingPrescription, setVerifyingPrescription] = useState<Prescription | null>(null);
  const [editingPrescription, setEditingPrescription] = useState<Prescription | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [verifyError, setVerifyError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const queryParams = {
    status: activeTab === "all" ? undefined : activeTab,
    page,
    limit: 20,
  };

  const { data: rawData, isLoading } = useQuery({
    queryKey: queryKeys.prescriptions.list(queryParams),
    queryFn: () => apiClient.get("/prescriptions", { params: queryParams }),
  });

  const prescriptions: Prescription[] = (() => {
    const d = rawData as any;
    if (Array.isArray(d)) return d;
    if (Array.isArray(d?.data)) return d.data;
    if (Array.isArray(d?.data?.data)) return d.data.data;
    return [];
  })();

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/prescriptions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.prescriptions.all() });
      toastSuccess("Prescription deleted", "The prescription record has been removed.");
      setConfirmDeleteId(null);
    },
    onError: (err: any) => {
      toastError("Delete failed", err?.response?.data?.message ?? "Could not delete this prescription.");
      setConfirmDeleteId(null);
    },
  });

  const verifyMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) =>
      apiClient.post(`/prescriptions/${id}/verify`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.prescriptions.all() });
      handleCloseVerify();
    },
    onError: (err: any) => {
      setVerifyError(err?.response?.data?.message ?? "Action failed.");
    },
  });

  function handleOpenVerify(prescription: Prescription) {
    setVerifyingPrescription(prescription);
    setRejectionReason("");
    setVerifyError("");
  }

  function handleCloseVerify() {
    setVerifyingPrescription(null);
    setRejectionReason("");
    setVerifyError("");
  }

  function handleVerify() {
    if (!verifyingPrescription) return;
    verifyMutation.mutate({ id: verifyingPrescription.id, body: { action: "verify" } });
  }

  function handleReject() {
    if (!verifyingPrescription) return;
    if (!rejectionReason.trim()) {
      setVerifyError("Please enter a rejection reason.");
      return;
    }
    verifyMutation.mutate({
      id: verifyingPrescription.id,
      body: { action: "reject", rejectionReason: rejectionReason.trim() },
    });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Prescriptions</h1>
          <p className="text-muted-foreground mt-1">Review, verify, and register patient prescriptions.</p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus size={16} /> New Prescription
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => { setActiveTab(tab.key); setPage(1); }}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-muted rounded-xl" />
          ))}
        </div>
      ) : prescriptions.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <FileText className="mx-auto mb-3 opacity-30" size={48} />
          <p className="font-medium">No prescriptions found.</p>
          <button
            onClick={() => setCreateOpen(true)}
            className="mt-3 text-sm text-primary hover:underline"
          >
            Register the first prescription
          </button>
        </div>
      ) : (
        <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 text-muted-foreground font-medium border-b">
                <tr>
                  <th className="px-6 py-4">Patient</th>
                  <th className="px-6 py-4">Doctor</th>
                  <th className="px-6 py-4">Hospital</th>
                  <th className="px-6 py-4">Issued Date</th>
                  <th className="px-6 py-4">Expiry Date</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {prescriptions.map((rx) => (
                  <tr key={rx.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-medium">{rx.patient?.name ?? "--"}</div>
                      <div className="text-xs text-muted-foreground">{rx.patient?.phone ?? ""}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div>{rx.doctorName}</div>
                      {rx.isControlled && (
                        <span className="inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 text-xs font-medium">
                          <AlertTriangle className="w-3 h-3" /> Controlled
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">{rx.hospitalName ?? "--"}</td>
                    <td className="px-6 py-4 text-muted-foreground">
                      {rx.issuedDate ? format(new Date(rx.issuedDate), "MMM d, yyyy") : "--"}
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">
                      {rx.expiryDate ? format(new Date(rx.expiryDate), "MMM d, yyyy") : "--"}
                    </td>
                    <td className="px-6 py-4">{statusBadge(rx.status)}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {rx.status === "pending_verification" && (
                          <button
                            onClick={() => handleOpenVerify(rx)}
                            className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90 transition-colors"
                          >
                            Verify
                          </button>
                        )}
                        <button
                          onClick={() => setEditingPrescription(rx)}
                          className="p-2 hover:bg-muted rounded-lg transition-colors text-muted-foreground hover:text-primary"
                          title="Edit prescription"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        {isAdmin && (
                          confirmDeleteId === rx.id ? (
                            <span className="flex items-center gap-1">
                              <button
                                onClick={() => deleteMutation.mutate(rx.id)}
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
                              onClick={() => setConfirmDeleteId(rx.id)}
                              className="p-2 hover:bg-red-50 rounded-lg transition-colors text-muted-foreground hover:text-red-600"
                              title="Delete prescription"
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

          {/* Pagination */}
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
                disabled={prescriptions.length < 20}
                className="px-3 py-1 border rounded-lg hover:bg-muted transition-colors disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Prescription Modal */}
      <CreatePrescriptionModal open={createOpen} onClose={() => setCreateOpen(false)} />

      {/* Edit Prescription Modal */}
      {editingPrescription && (
        <EditPrescriptionModal
          prescription={editingPrescription}
          onClose={() => setEditingPrescription(null)}
        />
      )}

      {/* Verify Modal */}
      <Modal
        title="Review Prescription"
        open={verifyingPrescription !== null}
        onClose={handleCloseVerify}
        size="md"
      >
        {verifyingPrescription && (
          <div className="px-6 py-5 space-y-4">
            {verifyError && (
              <div className="px-3 py-2 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">
                {verifyError}
              </div>
            )}

            <div className="space-y-2 text-sm">
              <div className="flex justify-between py-2 border-b">
                <span className="text-muted-foreground">Patient</span>
                <span className="font-medium">{verifyingPrescription.patient?.name ?? "--"}</span>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="text-muted-foreground">Doctor</span>
                <span className="font-medium">{verifyingPrescription.doctorName}</span>
              </div>
              {verifyingPrescription.hospitalName && (
                <div className="flex justify-between py-2 border-b">
                  <span className="text-muted-foreground">Hospital</span>
                  <span className="font-medium">{verifyingPrescription.hospitalName}</span>
                </div>
              )}
              <div className="flex justify-between py-2 border-b">
                <span className="text-muted-foreground">Issued</span>
                <span className="font-medium">
                  {verifyingPrescription.issuedDate
                    ? format(new Date(verifyingPrescription.issuedDate), "MMM d, yyyy")
                    : "--"}
                </span>
              </div>
              {verifyingPrescription.expiryDate && (
                <div className="flex justify-between py-2 border-b">
                  <span className="text-muted-foreground">Expiry</span>
                  <span className="font-medium">
                    {format(new Date(verifyingPrescription.expiryDate), "MMM d, yyyy")}
                  </span>
                </div>
              )}
              {verifyingPrescription.notes && (
                <div className="py-2">
                  <p className="text-muted-foreground text-xs mb-1">Notes</p>
                  <p>{verifyingPrescription.notes}</p>
                </div>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">
                Rejection Reason{" "}
                <span className="text-muted-foreground font-normal">(required only for rejection)</span>
              </label>
              <textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                rows={3}
                placeholder="Enter reason for rejection..."
                className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={handleCloseVerify}
                className="px-4 py-2 border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReject}
                disabled={verifyMutation.isPending}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-60"
              >
                {verifyMutation.isPending ? "Processing..." : "Reject"}
              </button>
              <button
                type="button"
                onClick={handleVerify}
                disabled={verifyMutation.isPending}
                className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-60"
              >
                {verifyMutation.isPending ? "Processing..." : "Verify"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
