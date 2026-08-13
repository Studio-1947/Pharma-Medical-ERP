"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, queryKeys } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth.store";
import { useToast } from "@/components/ui/toast";
import { UserPlus, Search, Edit2, Trash2, Phone, Calendar, Star, Eye, FileText, ClipboardList, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { format } from "date-fns";
import { Modal } from "@/components/ui/modal";
import { isValidPhoneNumber } from "@/lib/phone-validation";

interface Patient {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  bloodGroup?: string | null;
  address?: string | null;
  state?: string | null;
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
  ageYears: string;
  dateOfBirth: string;
  gender: string;
  address: string;
  state: string;
  pincode: string;
  bloodGroup: string;
  dobMode: "dob" | "age";
}

const emptyForm: PatientFormData = {
  name: "",
  phone: "",
  email: "",
  ageYears: "",
  dateOfBirth: "",
  gender: "",
  address: "",
  state: "West Bengal",
  pincode: "",
  bloodGroup: "",
  dobMode: "age",
};

const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

const inputCls =
  "w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition placeholder:text-slate-400";

const labelCls = "block text-xs font-semibold text-slate-600 mb-1";

function PrescriptionStatusBadge({ status }: { status: string }) {
  if (status === "verified")
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
        <CheckCircle2 size={10} /> Verified
      </span>
    );
  if (status === "rejected")
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
        <XCircle size={10} /> Rejected
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
      <AlertTriangle size={10} /> Pending
    </span>
  );
}

function PatientHistoryModal({ patient, onClose }: { patient: Patient | null; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<"prescriptions" | "billing">("prescriptions");

  // Reset to prescriptions tab whenever a new patient is selected
  useEffect(() => { setActiveTab("prescriptions"); }, [patient?.id]);

  const { data: invoicesRes, isLoading: loadingInvoices } = useQuery({
    queryKey: ["patient-invoices", patient?.id],
    queryFn: () => apiClient.get("/billing/invoices", { params: { patientId: patient!.id, limit: 20 } }),
    enabled: !!patient,
  });

  const { data: rxRes, isLoading: loadingRx } = useQuery({
    queryKey: queryKeys.prescriptions.list({ patientId: patient?.id ?? "", limit: 20 }),
    queryFn: () => apiClient.get("/prescriptions", { params: { patientId: patient!.id, limit: 20 } }) as Promise<any>,
    enabled: !!patient,
  });

  if (!patient) return null;

  const invoices: any[] = (invoicesRes as any)?.data ?? [];
  const prescriptions: any[] = (() => {
    const d = rxRes as any;
    if (Array.isArray(d)) return d;
    if (Array.isArray(d?.data)) return d.data;
    if (Array.isArray(d?.data?.data)) return d.data.data;
    return [];
  })();

  // Calculate age if dateOfBirth is present
  let ageDisplay = "N/A";
  if (patient.dateOfBirth) {
    const dob = new Date(patient.dateOfBirth);
    const ageYears = Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    if (!isNaN(ageYears) && ageYears >= 0) {
      ageDisplay = `${ageYears} yrs (${format(dob, "dd MMM yyyy")})`;
    }
  }

  return (
    <Modal
      title={`Patient Profile — ${patient.name}`}
      subtitle={`Phone: ${patient.phone} • Member since ${patient.createdAt ? format(new Date(patient.createdAt), "MMM yyyy") : "N/A"}`}
      open={!!patient}
      onClose={onClose}
      size="lg"
    >
      {/* NOTE: Modal already provides overflow-y-auto flex-col — no wrapper div needed */}
      <div className="-mx-5 sm:-mx-6 flex flex-col">
        {/* Demographics */}
        <div className="px-6 pt-5 pb-4 bg-slate-50/80 border-b border-slate-200">
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 mb-2.5">Patient Demographics &amp; Contact</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 text-xs">
            <div className="bg-white p-2.5 rounded-xl border border-slate-100 shadow-2xs">
              <span className="text-slate-400 block font-semibold text-[10px] uppercase">Gender</span>
              <span className="font-bold text-slate-900 capitalize">{patient.gender || "Not stated"}</span>
            </div>
            <div className="bg-white p-2.5 rounded-xl border border-slate-100 shadow-2xs">
              <span className="text-slate-400 block font-semibold text-[10px] uppercase">Age / DOB</span>
              <span className="font-bold text-slate-900">{ageDisplay}</span>
            </div>
            <div className="bg-white p-2.5 rounded-xl border border-slate-100 shadow-2xs">
              <span className="text-slate-400 block font-semibold text-[10px] uppercase">Blood Group</span>
              <span className={`font-black text-sm ${patient.bloodGroup ? "text-rose-600" : "text-slate-400"}`}>{patient.bloodGroup || "—"}</span>
            </div>
            <div className="bg-white p-2.5 rounded-xl border border-slate-100 shadow-2xs">
              <span className="text-slate-400 block font-semibold text-[10px] uppercase">Loyalty</span>
              <span className="font-bold text-amber-700">{patient.loyaltyPoints ?? 0} pts</span>
            </div>
            {patient.address && (
              <div className="bg-white p-2.5 rounded-xl border border-slate-100 shadow-2xs col-span-2 sm:col-span-3 md:col-span-4">
                <span className="text-slate-400 block font-semibold text-[10px] uppercase">Address</span>
                <span className="font-semibold text-slate-800 truncate block">{patient.address}</span>
              </div>
            )}
          </div>
          {patient.allergies && patient.allergies.length > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase text-rose-500">Known Allergies:</span>
              <div className="flex flex-wrap gap-1">
                {patient.allergies.map((alg, i) => (
                  <span key={i} className="text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 rounded-md">{alg}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Tab Bar */}
        <div className="flex items-center gap-1 px-6 pt-3 border-b border-slate-200 bg-white">
          <button
            type="button"
            onClick={() => setActiveTab("prescriptions")}
            className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold border-b-2 transition-colors ${
              activeTab === "prescriptions"
                ? "border-emerald-600 text-emerald-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <FileText size={13} />
            Prescriptions
            {prescriptions.length > 0 && (
              <span className="ml-1 bg-emerald-100 text-emerald-800 text-[10px] font-black px-1.5 py-0.5 rounded-full">
                {prescriptions.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("billing")}
            className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold border-b-2 transition-colors ${
              activeTab === "billing"
                ? "border-emerald-600 text-emerald-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <ClipboardList size={13} />
            Dispensing History
            {invoices.length > 0 && (
              <span className="ml-1 bg-slate-100 text-slate-700 text-[10px] font-black px-1.5 py-0.5 rounded-full">
                {invoices.length}
              </span>
            )}
          </button>
        </div>

        {/* Tab Body */}
        <div className="px-6 py-4">

          {/* ── PRESCRIPTIONS TAB ── */}
          {activeTab === "prescriptions" && (
            loadingRx ? (
              <div className="space-y-2 py-4">
                {[1,2,3].map(i => <div key={i} className="h-14 rounded-xl bg-slate-100 animate-pulse" />)}
              </div>
            ) : prescriptions.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <FileText className="mx-auto mb-3 opacity-30" size={40} />
                <p className="font-semibold text-sm">No prescriptions found for this patient.</p>
                <p className="text-xs mt-1">Prescriptions written by doctors will appear here once created.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {prescriptions.map((rx: any) => {
                  const items: any[] = rx.items ?? rx.medicines ?? [];
                  // isControlled can come from the Rx header OR from any joined medicine
                  const isControlled = rx.isControlled || items.some(
                    (it: any) => it.isControlled || it.medicine?.isControlled ||
                                 it.medicine?.scheduleClass || it.scheduleClass
                  );
                  return (
                    <div
                      key={rx.id}
                      className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs"
                    >
                      {/* Rx Header */}
                      <div className="flex items-start justify-between px-4 py-3 bg-slate-50 border-b border-slate-100">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-black font-mono text-slate-700">
                              Rx #{rx.id?.slice(0, 8).toUpperCase()}
                            </span>
                            <PrescriptionStatusBadge status={rx.status} />
                            {isControlled && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-50 text-orange-700 border border-orange-200">
                                <AlertTriangle size={9} /> Controlled
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500">
                            <span className="font-semibold text-slate-700">Dr. {rx.doctorName || "Unknown"}</span>
                            {rx.hospitalName && <> &bull; {rx.hospitalName}</>}
                          </p>
                        </div>
                        <div className="text-right text-[11px] text-slate-500 shrink-0 ml-3">
                          <div>
                            <span className="font-semibold text-slate-700">Issued:</span>{" "}
                            {rx.issuedDate ? format(new Date(rx.issuedDate), "dd MMM yyyy") : rx.createdAt ? format(new Date(rx.createdAt), "dd MMM yyyy") : "—"}
                          </div>
                          {rx.expiryDate && (
                            <div className="text-rose-600 font-semibold">
                              Expires: {format(new Date(rx.expiryDate), "dd MMM yyyy")}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Rx Medicines List */}
                      {items.length > 0 && (
                        <div className="px-4 py-3 space-y-2.5">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                            Prescribed Medicines ({items.length})
                          </p>
                          {items.map((it: any, idx: number) => {
                            // The backend joins `medicine` object onto each item
                            const med = it.medicine ?? {};
                            const displayName = it.medicineName || med.name || `Medicine ${idx + 1}`;
                            const brandName   = med.brandName || null;
                            const generic     = med.genericName || med.composition || null;
                            const strength    = med.strength || null;
                            const dosageForm  = med.dosageForm || null;
                            const packSize    = med.packSize || null;
                            const sku         = med.sku || null;
                            const hsnCode     = med.hsnCode || null;
                            const manufacturer = med.manufacturer || null;
                            const therapeuticClass = med.therapeuticClass || null;
                            const scheduleClass = it.scheduleClass || med.scheduleClass || null;
                            const isControlled = it.isControlled || med.isControlled || false;
                            const requiresPrescription = med.requiresPrescription || false;
                            const mrp         = med.priceMrp ? `₹${parseFloat(med.priceMrp).toFixed(2)}` : null;
                            const taxPct      = med.taxPercent ? `${parseFloat(med.taxPercent)}%` : null;
                            const qtyPrescribed  = it.quantityPrescribed ?? null;
                            const qtyDispensed   = it.quantityDispensed ?? 0;
                            const isFullyDispensed = it.isFullyDispensed ?? false;

                            return (
                              <div key={idx} className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs">
                                {/* Medicine Header */}
                                <div className="flex items-start justify-between px-3.5 py-2.5 bg-emerald-50/60 border-b border-slate-200/80">
                                  <div className="flex items-start gap-2.5 min-w-0">
                                    <span className="w-6 h-6 rounded-full bg-emerald-600 text-white text-[11px] font-black flex items-center justify-center shrink-0 mt-0.5">
                                      {idx + 1}
                                    </span>
                                    <div className="min-w-0">
                                      <p className="font-black text-slate-900 text-sm leading-tight">
                                        {displayName}
                                      </p>
                                      {brandName && brandName !== displayName && (
                                        <p className="text-[11px] font-semibold text-emerald-700">
                                          Brand: {brandName}
                                        </p>
                                      )}
                                      {generic && (
                                        <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                                          {generic}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                  {/* Badges */}
                                  <div className="flex flex-wrap gap-1 justify-end shrink-0 ml-2">
                                    {scheduleClass && (
                                      <span className="text-[10px] font-black text-orange-700 bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded">
                                        {scheduleClass}
                                      </span>
                                    )}
                                    {isControlled && (
                                      <span className="text-[10px] font-black text-red-700 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded">
                                        Controlled
                                      </span>
                                    )}
                                    {requiresPrescription && !isControlled && (
                                      <span className="text-[10px] font-bold text-violet-700 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded">
                                        Rx
                                      </span>
                                    )}
                                    {isFullyDispensed && (
                                      <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                                        ✓ Dispensed
                                      </span>
                                    )}
                                  </div>
                                </div>

                                {/* Medicine Details Grid */}
                                <div className="px-3.5 py-2.5 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 text-[11px]">
                                  {/* Formulation */}
                                  {(strength || dosageForm) && (
                                    <div>
                                      <span className="text-slate-400 font-bold uppercase text-[9px] tracking-wider block">Strength / Form</span>
                                      <span className="text-slate-800 font-semibold">
                                        {[strength, dosageForm].filter(Boolean).join(" · ")}
                                      </span>
                                    </div>
                                  )}
                                  {packSize && (
                                    <div>
                                      <span className="text-slate-400 font-bold uppercase text-[9px] tracking-wider block">Pack Size</span>
                                      <span className="text-slate-800 font-semibold">{packSize}</span>
                                    </div>
                                  )}
                                  {hsnCode && (
                                    <div>
                                      <span className="text-slate-400 font-bold uppercase text-[9px] tracking-wider block">HSN Code</span>
                                      <span className="text-slate-800 font-mono font-bold text-xs">{hsnCode}</span>
                                    </div>
                                  )}
                                  {sku && (
                                    <div>
                                      <span className="text-slate-400 font-bold uppercase text-[9px] tracking-wider block">SKU</span>
                                      <span className="text-slate-700 font-mono">{sku}</span>
                                    </div>
                                  )}
                                  {manufacturer && (
                                    <div className="col-span-2">
                                      <span className="text-slate-400 font-bold uppercase text-[9px] tracking-wider block">Manufacturer</span>
                                      <span className="text-slate-800 font-semibold">{manufacturer}</span>
                                    </div>
                                  )}
                                  {therapeuticClass && (
                                    <div className="col-span-2">
                                      <span className="text-slate-400 font-bold uppercase text-[9px] tracking-wider block">Therapeutic Class</span>
                                      <span className="text-slate-700">{therapeuticClass}</span>
                                    </div>
                                  )}
                                  {(mrp || taxPct) && (
                                    <div>
                                      <span className="text-slate-400 font-bold uppercase text-[9px] tracking-wider block">MRP / GST</span>
                                      <span className="text-slate-800 font-semibold">
                                        {mrp ?? "—"}{taxPct ? ` (GST ${taxPct})` : ""}
                                      </span>
                                    </div>
                                  )}
                                </div>

                                {/* Prescription Instructions Row — only render if at least one field is set */}
                                {(it.dosage || it.frequency || it.duration || qtyPrescribed != null) && (
                                  <div className="px-3.5 py-2.5 border-t border-dashed border-slate-200 bg-slate-50/60 flex flex-wrap gap-x-5 gap-y-1.5 text-[11px]">
                                    {it.dosage && (
                                      <div>
                                        <span className="text-slate-400 font-bold uppercase text-[9px] tracking-wider block">Dosage</span>
                                        <span className="text-slate-800 font-semibold">{it.dosage}</span>
                                      </div>
                                    )}
                                    {it.frequency && (
                                      <div>
                                        <span className="text-slate-400 font-bold uppercase text-[9px] tracking-wider block">Frequency</span>
                                        <span className="text-slate-800 font-semibold">{it.frequency}</span>
                                      </div>
                                    )}
                                    {it.duration && (
                                      <div>
                                        <span className="text-slate-400 font-bold uppercase text-[9px] tracking-wider block">Duration</span>
                                        <span className="text-slate-800 font-semibold">{it.duration}</span>
                                      </div>
                                    )}
                                    {qtyPrescribed != null && (
                                      <div>
                                        <span className="text-slate-400 font-bold uppercase text-[9px] tracking-wider block">Qty Prescribed</span>
                                        <span className="text-slate-800 font-semibold">
                                          {qtyPrescribed}
                                          {qtyDispensed > 0 && (
                                            <span className={`ml-1 font-bold ${isFullyDispensed ? "text-emerald-600" : "text-amber-600"}`}>
                                              ({qtyDispensed} dispensed)
                                            </span>
                                          )}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}


                      {/* Notes if any */}
                      {rx.notes && (
                        <div className="px-4 pb-2.5">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">Doctor Notes</p>
                          <p className="text-xs text-slate-600 italic">{rx.notes}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          )}

          {/* ── BILLING / DISPENSING HISTORY TAB ── */}
          {activeTab === "billing" && (
            loadingInvoices ? (
              <div className="space-y-2 py-4">
                {[1,2,3].map(i => <div key={i} className="h-12 rounded-xl bg-slate-100 animate-pulse" />)}
              </div>
            ) : invoices.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <ClipboardList className="mx-auto mb-3 opacity-30" size={40} />
                <p className="font-semibold text-sm">No dispensing history for this patient.</p>
              </div>
            ) : (
              <div className="border rounded-xl overflow-hidden">
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
                        <td className="px-3 py-2 text-right font-bold text-slate-800">₹{parseFloat(inv.totalAmount ?? 0).toFixed(2)}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            inv.status === "paid" || inv.status === "confirmed"
                              ? "bg-green-100 text-green-700"
                              : "bg-amber-100 text-amber-700"
                          }`}>
                            {inv.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
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
  const isDoctor = user?.role === "doctor";
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
      queryClient.invalidateQueries({ queryKey: queryKeys.clinicTokens.all() });
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
    const dobStr = patient.dateOfBirth ? patient.dateOfBirth.split("T")[0] : "";
    let calcAge = "";
    if (dobStr) {
      const bDate = new Date(dobStr);
      const ageDiff = Math.floor((Date.now() - bDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
      if (ageDiff >= 0) calcAge = String(ageDiff);
    }

    setForm({
      name: patient.name ?? "",
      phone: patient.phone ?? "",
      email: patient.email ?? "",
      ageYears: calcAge,
      dateOfBirth: dobStr ?? "",
      gender: patient.gender ?? "",
      address: patient.address ?? "",
      state: patient.state ?? "West Bengal",
      pincode: "",
      bloodGroup: patient.bloodGroup ?? "",
      dobMode: dobStr ? "dob" : "age",
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
      setFormError("Name and Phone are required.");
      return;
    }
    if (!isValidPhoneNumber(form.phone)) {
      setFormError("Please enter a valid 10-digit mobile number (e.g. 9876543210 or +91 9876543210).");
      return;
    }
    const payload: Record<string, any> = {
      name: form.name.trim(),
      phone: form.phone.trim(),
    };
    if (form.email.trim()) payload.email = form.email.trim();

    let dobValue = form.dateOfBirth;
    if (form.dobMode === "age" && form.ageYears.trim()) {
      const ageNum = parseInt(form.ageYears.trim(), 10);
      if (!isNaN(ageNum) && ageNum > 0 && ageNum < 130) {
        const birthYear = new Date().getFullYear() - ageNum;
        dobValue = `${birthYear}-01-01`;
      }
    }
    if (dobValue) payload.dateOfBirth = new Date(dobValue).toISOString();
    if (form.gender) payload.gender = form.gender;

    let fullAddress = form.address.trim();
    if (form.pincode.trim()) {
      fullAddress = fullAddress ? `${fullAddress} - ${form.pincode.trim()}` : `PIN: ${form.pincode.trim()}`;
    }
    if (fullAddress) payload.address = fullAddress;
    payload.state = form.state.trim() || "West Bengal";
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
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            {isDoctor ? "My Served Patients" : "Patients"}
          </h1>
          <p className="text-muted-foreground mt-1">
            {isDoctor
              ? "Directory of patients assigned to your consultations and prescriptions."
              : "Manage registered patients and their records."}
          </p>
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
          <p className="font-medium">
            {isDoctor ? "No patients assigned to your consultations yet." : "No patients registered yet."}
          </p>
          <p className="text-sm mt-1">
            {isDoctor
              ? "Patients booked for your clinic queue or prescriptions will automatically appear here."
              : "Click \"Register Patient\" to add the first patient."}
          </p>
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
              <div className="space-y-4">
                {/* Gender Radio Buttons */}
                <div>
                  <label className={labelCls}>Gender</label>
                  <div className="flex items-center gap-2 mt-1">
                    {[
                      { value: "male", label: "Male" },
                      { value: "female", label: "Female" },
                      { value: "other", label: "Other" },
                    ].map((g) => (
                      <label
                        key={g.value}
                        className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer transition-all ${
                          form.gender === g.value
                            ? "bg-emerald-50 border-emerald-500 text-emerald-800 shadow-xs"
                            : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
                        }`}
                      >
                        <input
                          type="radio"
                          name="patientGender"
                          value={g.value}
                          checked={form.gender === g.value}
                          onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value }))}
                          className="accent-emerald-600 w-3.5 h-3.5 cursor-pointer"
                        />
                        <span>{g.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Age vs DOB Toggle & Inputs */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className={labelCls}>Age &amp; Date of Birth</label>
                    <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg text-[10px] font-bold">
                      <button
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, dobMode: "age" }))}
                        className={`px-2 py-0.5 rounded-md transition-all ${
                          form.dobMode === "age" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-800"
                        }`}
                      >
                        Age (Years)
                      </button>
                      <button
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, dobMode: "dob" }))}
                        className={`px-2 py-0.5 rounded-md transition-all ${
                          form.dobMode === "dob" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-800"
                        }`}
                      >
                        Exact Date of Birth
                      </button>
                    </div>
                  </div>

                  {form.dobMode === "age" ? (
                    <div className="relative">
                      <input
                        type="number"
                        min="1"
                        max="120"
                        value={form.ageYears}
                        onChange={(e) => {
                          const val = e.target.value;
                          const ageNum = parseInt(val, 10);
                          let approxDob = "";
                          if (!isNaN(ageNum) && ageNum > 0 && ageNum < 120) {
                            const bYear = new Date().getFullYear() - ageNum;
                            approxDob = `${bYear}-01-01`;
                          }
                          setForm((f) => ({ ...f, ageYears: val, dateOfBirth: approxDob }));
                        }}
                        placeholder="Enter patient age in years (e.g. 45)"
                        className={inputCls}
                      />
                      {form.dateOfBirth && (
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                          Birth Year: {form.dateOfBirth.split("-")[0]}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div>
                      <input
                        type="date"
                        value={form.dateOfBirth}
                        onChange={(e) => {
                          const dobVal = e.target.value;
                          let calcAge = "";
                          if (dobVal) {
                            const bDate = new Date(dobVal);
                            const ageDiff = Math.floor((Date.now() - bDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
                            if (ageDiff >= 0) calcAge = String(ageDiff);
                          }
                          setForm((f) => ({ ...f, dateOfBirth: dobVal, ageYears: calcAge }));
                        }}
                        max={new Date().toISOString().split("T")[0]}
                        className={inputCls}
                      />
                      {form.ageYears && (
                        <p className="text-[11px] font-semibold text-emerald-700 mt-1">
                          Calculated Age: {form.ageYears} years old
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Blood Group */}
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
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-3">Address &amp; Location</p>
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
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>State</label>
                    <input
                      type="text"
                      value={form.state}
                      onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
                      placeholder="West Bengal"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Pincode / Zip Code</label>
                    <input
                      type="text"
                      value={form.pincode}
                      onChange={(e) => setForm((f) => ({ ...f, pincode: e.target.value }))}
                      placeholder="e.g. 700001"
                      className={inputCls}
                    />
                  </div>
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
