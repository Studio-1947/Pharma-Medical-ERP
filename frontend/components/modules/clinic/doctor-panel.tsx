"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient, queryKeys } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth.store";
import { useToast } from "@/components/ui/toast";
import { useClinicTokens, useClinicToken, useUpdateClinicToken } from "@/queries/clinic.queries";
import { localDateString } from "@/lib/date";
import {
  formatClockTime,
  formatDuration,
  durationMinutes,
  elapsedSince,
} from "@/lib/consultation-time";
import { PrescriptionScanUpload } from "@/components/modules/prescriptions/prescription-scan-upload";
import { MedicineAutocomplete, type MedicineOption } from "@/components/modules/prescriptions/medicine-autocomplete";
import { PrescriptionDetailModal } from "@/components/modules/prescriptions/prescription-detail-modal";
import { InvoiceDetailModal } from "@/components/modules/billing/invoice-detail-modal";
import {
  Stethoscope, Clock, PhoneCall, CheckCircle2, User, AlertTriangle,
  Plus, Trash2, Upload, FileText, History, ChevronRight,
  Image as ImageIcon,
} from "lucide-react";
import { format } from "date-fns";

interface RxItem {
  medicineId?: string;
  medicineName: string;
  dosage: string;
  frequency: string;
  duration: string;
  quantityPrescribed: number | "";
}

function blankItem(): RxItem {
  return { medicineName: "", dosage: "", frequency: "", duration: "", quantityPrescribed: "" };
}

function queueStatusIcon(status: string) {
  switch (status) {
    case "pending": return <Clock className="w-3.5 h-3.5 text-yellow-600" />;
    case "called": return <PhoneCall className="w-3.5 h-3.5 text-blue-600" />;
    case "completed": return <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />;
    default: return null;
  }
}

// ─── Medicine autocomplete row ────────────────────────────────────────────────

function MedicineRow({
  item,
  onChange,
  onSelectMedicine,
  onRemove,
  removable,
  idx,
}: {
  item: RxItem;
  onChange: (patch: Partial<RxItem>) => void;
  onSelectMedicine: (m: MedicineOption) => void;
  onRemove: () => void;
  removable: boolean;
  idx?: number;
}) {
  return (
    <>
      {/* Desktop Table Row */}
      <tr className="hidden md:table-row hover:bg-slate-50/60 transition-colors">
        <td className="px-2 py-2 min-w-[240px]">
          <MedicineAutocomplete
            value={item.medicineName}
            linked={!!item.medicineId}
            onChange={(text) => onChange({ medicineName: text, medicineId: undefined })}
            onSelect={onSelectMedicine}
            placeholder="Search medicine name..."
          />
        </td>
        <td className="px-2 py-2">
          <input
            type="text"
            value={item.dosage}
            onChange={(e) => onChange({ dosage: e.target.value })}
            placeholder="e.g. 500mg"
            className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 bg-white"
          />
        </td>
        <td className="px-2 py-2">
          <input
            type="text"
            list="dp-frequency-list"
            value={item.frequency}
            onChange={(e) => onChange({ frequency: e.target.value })}
            placeholder="1-0-1 / BD"
            className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 bg-white"
          />
        </td>
        <td className="px-2 py-2">
          <input
            type="text"
            list="dp-duration-list"
            value={item.duration}
            onChange={(e) => onChange({ duration: e.target.value })}
            placeholder="5 days"
            className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 bg-white"
          />
        </td>
        <td className="px-2 py-2">
          <input
            type="number"
            min={1}
            value={item.quantityPrescribed}
            onChange={(e) => onChange({ quantityPrescribed: e.target.value === "" ? "" : Number(e.target.value) })}
            placeholder="10"
            className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 bg-white"
          />
        </td>
        <td className="px-2 py-2 text-center">
          <button
            type="button"
            onClick={onRemove}
            disabled={!removable}
            title="Remove medicine"
            className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md disabled:opacity-30 transition-colors"
          >
            <Trash2 size={14} />
          </button>
        </td>
      </tr>

      {/* Mobile Card View */}
      <tr className="md:hidden border-b border-slate-200 last:border-b-0">
        <td colSpan={6} className="p-3 bg-slate-50/50">
          <div className="space-y-2.5 bg-white p-3 rounded-xl border border-slate-200/80 shadow-2xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-700">Medicine #{((idx ?? 0) + 1)}</span>
              <button
                type="button"
                onClick={onRemove}
                disabled={!removable}
                className="p-1 text-slate-400 hover:text-red-500 disabled:opacity-30"
              >
                <Trash2 size={14} />
              </button>
            </div>

            <MedicineAutocomplete
              value={item.medicineName}
              linked={!!item.medicineId}
              onChange={(text) => onChange({ medicineName: text, medicineId: undefined })}
              onSelect={onSelectMedicine}
              placeholder="Search medicine name..."
            />

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-semibold uppercase text-slate-500">Dosage</label>
                <input
                  type="text"
                  value={item.dosage}
                  onChange={(e) => onChange({ dosage: e.target.value })}
                  placeholder="e.g. 500mg"
                  className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase text-slate-500">Frequency</label>
                <input
                  type="text"
                  list="dp-frequency-list"
                  value={item.frequency}
                  onChange={(e) => onChange({ frequency: e.target.value })}
                  placeholder="1-0-1 / BD"
                  className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-semibold uppercase text-slate-500">Duration</label>
                <input
                  type="text"
                  list="dp-duration-list"
                  value={item.duration}
                  onChange={(e) => onChange({ duration: e.target.value })}
                  placeholder="5 days"
                  className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase text-slate-500">Quantity</label>
                <input
                  type="number"
                  min={1}
                  value={item.quantityPrescribed}
                  onChange={(e) => onChange({ quantityPrescribed: e.target.value === "" ? "" : Number(e.target.value) })}
                  placeholder="10"
                  className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
              </div>
            </div>
          </div>
        </td>
      </tr>
    </>
  );
}

// ─── Consultation clock ───────────────────────────────────────────────────────

/**
 * Start/end of the consultation, and how long it ran.
 *
 * While a consultation is in progress the elapsed figure ticks every 30s — a
 * doctor glancing at it wants to know how long this patient has been in the
 * room right now, not when the clock was last re-rendered by something else.
 */
function ConsultationClock({ token }: { token: any }) {
  const [now, setNow] = useState(() => Date.now());
  const running = token.status === "called" && token.calledAt;

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [running]);

  const started = formatClockTime(token.calledAt);
  const ended = formatClockTime(token.completedAt);

  if (!started) {
    return (
      <span className="text-[11px] text-muted-foreground">
        Not started
      </span>
    );
  }

  if (token.completedAt) {
    const took = formatDuration(durationMinutes(token.calledAt, token.completedAt));
    return (
      <span className="text-[11px] text-muted-foreground tabular-nums">
        {started} – {ended}
        {took ? ` · ${took}` : ""}
      </span>
    );
  }

  const elapsed = elapsedSince(token.calledAt, now);
  return (
    <span className="text-[11px] text-blue-600 font-medium tabular-nums">
      Started {started}
      {elapsed ? ` · ${elapsed} elapsed` : ""}
    </span>
  );
}

// ─── Consultation workspace for the selected token ────────────────────────────

function ConsultationWorkspace({ tokenId, onCompleted }: { tokenId: string; onCompleted: () => void }) {
  const qc = useQueryClient();
  const { success: toastSuccess, error: toastError } = useToast();
  const { data: tokenRes, isLoading } = useClinicToken(tokenId);
  const token = (tokenRes as any)?.data;
  const updateMutation = useUpdateClinicToken(tokenId);

  const [activeTab, setActiveTab] = useState<"history" | "prescribe" | "scan">("history");
  const [items, setItems] = useState<RxItem[]>([blankItem()]);
  const [isControlled, setIsControlled] = useState(false);
  const [notes, setNotes] = useState("");
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // History rows open read-only detail views; both are fetched on demand.
  const [openPrescriptionId, setOpenPrescriptionId] = useState<string | null>(null);
  const [openInvoiceId, setOpenInvoiceId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const patientId: string | undefined = token?.patient?.id;

  const { data: historyRx } = useQuery({
    queryKey: ["clinic-patient-rx-history", patientId],
    queryFn: () => apiClient.get("/prescriptions", { params: { patientId, limit: 20 } }) as Promise<any>,
    enabled: !!patientId,
  });
  const { data: historyInvoices } = useQuery({
    queryKey: ["clinic-patient-invoice-history", patientId],
    queryFn: () => apiClient.get("/billing/invoices", { params: { patientId, limit: 20 } }) as Promise<any>,
    enabled: !!patientId,
  });

  const rxHistory: any[] = (() => {
    const d = (historyRx as any)?.data;
    return Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : [];
  })();
  const invoiceHistory: any[] = (() => {
    const d = (historyInvoices as any)?.data;
    return Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : [];
  })();

  function updateItem(idx: number, patch: Partial<RxItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function selectMedicine(idx: number, m: MedicineOption) {
    setItems((prev) => {
      const next = prev.map((it, i) =>
        i === idx
          ? { ...it, medicineId: m.id, medicineName: m.name, dosage: it.dosage || m.strength || "" }
          : it,
      );
      // Spare row kept ready so a multi-drug prescription is one continuous pass.
      return idx === prev.length - 1 ? [...next, blankItem()] : next;
    });
  }

  function addItem() { setItems((prev) => [...prev, blankItem()]); }
  function removeItem(idx: number) { setItems((prev) => prev.filter((_, i) => i !== idx)); }

  async function callPatient() {
    await updateMutation.mutateAsync({ status: "called" });
  }

  async function completeConsultation() {
    if (!token) return;
    const rxItems = items
      .filter((i) => i.medicineName.trim())
      .map((i) => ({
        medicineId: i.medicineId,
        medicineName: i.medicineName.trim(),
        dosage: i.dosage || undefined,
        frequency: i.frequency || undefined,
        duration: i.duration || undefined,
        quantityPrescribed: i.quantityPrescribed !== "" ? Number(i.quantityPrescribed) : undefined,
      }));

    if (rxItems.length === 0 && !uploadedUrl) {
      setFormError("Add at least one medicine or upload a prescription scan before completing.");
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      const today = new Date();
      const expiry = new Date(today);
      expiry.setDate(expiry.getDate() + 30);

      const doc = token.doctor;
      const doctorName = [doc?.firstName, doc?.lastName].filter(Boolean).join(" ") || doc?.email || "Doctor";

      const rxRes: any = await apiClient.post("/prescriptions", {
        patientId: token.patient.id,
        doctorName,
        issuedDate: localDateString(today),
        expiryDate: localDateString(expiry),
        notes: notes.trim() || undefined,
        isControlled,
        fileUrl: uploadedUrl ?? undefined,
        items: rxItems.length > 0 ? rxItems : undefined,
      });
      const prescriptionId = rxRes?.data?.id ?? rxRes?.data?.data?.id;

      await updateMutation.mutateAsync({ status: "completed", prescriptionId });
      qc.invalidateQueries({ queryKey: queryKeys.clinicTokens.all() });
      toastSuccess("Consultation completed", "Prescription linked to token.");
      onCompleted();
    } catch (err: any) {
      const message = err?.response?.data?.message ?? "Failed to complete consultation.";
      setFormError(message);
      toastError("Could not complete consultation", message);
    } finally {
      setSubmitting(false);
    }
  }

  if (isLoading || !token) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Loading token...</div>;
  }

  const patient = token.patient;
  const isTerminal = token.status === "completed" || token.status === "cancelled";

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Patient header */}
      <div className="border-b px-6 py-4 flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <User className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">{patient?.name ?? "--"}</h2>
            <p className="text-sm text-muted-foreground">
              {patient?.phone} {patient?.gender ? `· ${patient.gender}` : ""} {patient?.bloodGroup ? `· ${patient.bloodGroup}` : ""}
            </p>
            {Array.isArray(patient?.allergies) && patient.allergies.length > 0 && (
              <div className="flex items-center gap-1 mt-1 text-xs text-red-600 font-medium">
                <AlertTriangle size={12} /> Allergies: {patient.allergies.join(", ")}
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-2">
            {token.timeSlot && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-600 font-medium">
                <Clock size={11} /> {token.timeSlot}
              </span>
            )}
            <span className="text-xs px-2 py-1 rounded-full bg-muted font-medium">Token #{token.tokenNo}</span>
            {token.status === "pending" && (
              <button onClick={callPatient} disabled={updateMutation.isPending} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors disabled:opacity-50">
                Call Patient
              </button>
            )}
          </div>
          <ConsultationClock token={token} />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b px-6">
        {[
          { key: "history", label: "History", icon: History },
          { key: "prescribe", label: "Write Prescription", icon: FileText },
          { key: "scan", label: "Upload Scan", icon: Upload },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as typeof activeTab)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <tab.icon size={14} /> {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === "history" && (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold mb-2">Previous Prescriptions</h3>
              {rxHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground">No past prescriptions on record.</p>
              ) : (
                <div className="space-y-2">
                  {rxHistory.map((rx: any) => (
                    // Opens the full prescription. The list endpoint returns
                    // header rows only — no items — so the drugs themselves are
                    // only reachable by fetching the single record.
                    <button
                      key={rx.id}
                      onClick={() => setOpenPrescriptionId(rx.id)}
                      className="w-full text-left border rounded-lg px-3 py-2 text-sm hover:bg-muted/50 hover:border-primary/30 transition-colors group"
                    >
                      <div className="flex justify-between items-center gap-2">
                        <span className="font-medium truncate">{rx.doctorName}</span>
                        <span className="flex items-center gap-1.5 shrink-0">
                          {rx.fileUrl && (
                            <ImageIcon size={11} className="text-muted-foreground" />
                          )}
                          <span className="text-muted-foreground text-xs">
                            {rx.issuedDate ? format(new Date(rx.issuedDate), "MMM d, yyyy") : ""}
                          </span>
                          <ChevronRight
                            size={13}
                            className="text-muted-foreground/40 group-hover:text-primary transition-colors"
                          />
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <h3 className="text-sm font-semibold mb-2">Billing History</h3>
              {invoiceHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground">No past invoices on record.</p>
              ) : (
                <div className="space-y-2">
                  {invoiceHistory.map((inv: any) => (
                    // Opens the dispensing record: which drugs, and crucially
                    // which physical batch the patient was given.
                    <button
                      key={inv.id}
                      onClick={() => setOpenInvoiceId(inv.id)}
                      className="w-full text-left border rounded-lg px-3 py-2 text-sm flex justify-between items-center gap-2 hover:bg-muted/50 hover:border-primary/30 transition-colors group"
                    >
                      <span className="font-medium truncate">{inv.invoiceNo}</span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        <span className="text-muted-foreground text-xs">
                          {inv.createdAt ? format(new Date(inv.createdAt), "MMM d, yyyy") : ""} · ₹{inv.totalAmount}
                        </span>
                        <ChevronRight
                          size={13}
                          className="text-muted-foreground/40 group-hover:text-primary transition-colors"
                        />
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "prescribe" && (
          <div className="space-y-4">
            <datalist id="dp-frequency-list">
              <option value="1-0-1 (BD)" />
              <option value="1-1-1 (TDS)" />
              <option value="1-0-0 (OD)" />
              <option value="0-0-1 (HS)" />
              <option value="STAT" />
              <option value="PRN" />
            </datalist>
            <datalist id="dp-duration-list">
              <option value="3 days" />
              <option value="5 days" />
              <option value="7 days" />
              <option value="10 days" />
              <option value="14 days" />
              <option value="30 days" />
            </datalist>

            <div className="rounded-xl border border-slate-200 overflow-x-auto shadow-2xs bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-700 text-xs uppercase tracking-wider font-bold border-b border-slate-200">
                  <tr>
                    <th className="text-left px-3 py-2.5 min-w-[260px]">Medicine Name</th>
                    <th className="text-left px-3 py-2.5 min-w-[110px]">Dosage</th>
                    <th className="text-left px-3 py-2.5 min-w-[120px]">Frequency</th>
                    <th className="text-left px-3 py-2.5 min-w-[110px]">Duration</th>
                    <th className="text-left px-3 py-2.5 w-20 min-w-[80px]">Qty</th>
                    <th className="w-10 text-center" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {items.map((item, idx) => (
                    <MedicineRow
                      key={idx}
                      item={item}
                      onChange={(patch) => updateItem(idx, patch)}
                      onSelectMedicine={(m) => selectMedicine(idx, m)}
                      onRemove={() => removeItem(idx)}
                      removable={items.length > 1}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={addItem}
                className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 hover:text-emerald-800 bg-emerald-50 border border-emerald-200/80 px-3 py-1.5 rounded-lg hover:bg-emerald-100/70 transition-all shadow-2xs"
              >
                <Plus size={14} /> Add Medicine
              </button>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input id="dp-controlled" type="checkbox" checked={isControlled} onChange={(e) => setIsControlled(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary" />
              <label htmlFor="dp-controlled" className="text-sm font-medium select-none cursor-pointer">
                Controlled Drug
                <span className="block text-xs text-muted-foreground font-normal">Schedule H / H1 / X</span>
              </label>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Consultation Notes</label>
              <textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Diagnosis, advice, follow-up..."
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              />
            </div>
          </div>
        )}

        {activeTab === "scan" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Wrote this prescription by hand? Photograph the paper slip and it
              is attached to the consultation for the pharmacist to read.
            </p>
            <PrescriptionScanUpload
              value={uploadedUrl}
              onChange={setUploadedUrl}
              variant="full"
              disabled={isTerminal}
            />
          </div>
        )}
      </div>

      {formError && (
        <div className="mx-6 mb-3 flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertTriangle size={14} /> {formError}
        </div>
      )}

      <div className="border-t px-6 py-4 flex justify-end">
        <button
          onClick={completeConsultation}
          disabled={submitting || isTerminal}
          className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {submitting ? (
            <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Completing...</>
          ) : isTerminal ? (
            <><CheckCircle2 size={14} /> Consultation Completed</>
          ) : (
            <><CheckCircle2 size={14} /> Complete Consultation</>
          )}
        </button>
      </div>

      {openPrescriptionId && (
        <PrescriptionDetailModal
          prescriptionId={openPrescriptionId}
          onClose={() => setOpenPrescriptionId(null)}
        />
      )}
      {openInvoiceId && (
        <InvoiceDetailModal
          invoiceId={openInvoiceId}
          onClose={() => setOpenInvoiceId(null)}
        />
      )}
    </div>
  );
}

// ─── Main doctor panel ─────────────────────────────────────────────────────────

export function DoctorPanel() {
  const { user } = useAuthStore();
  const [date] = useState(localDateString());
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);

  // Wait for the signed-in doctor's id before querying. Sending doctorId as
  // undefined asks for every doctor's queue; the API now pins it to the caller
  // anyway, but there is no reason to fire a request that can only be wrong.
  const params = { date, doctorId: user?.id, limit: 100 };
  const { data: tokensRes, isLoading } = useClinicTokens(params, { enabled: !!user?.id });
  const tokensRaw = (tokensRes as any)?.data;
  const tokens: any[] = Array.isArray(tokensRaw) ? tokensRaw : Array.isArray(tokensRaw?.data) ? tokensRaw.data : [];

  const pending = tokens.filter((t) => t.status === "pending");
  const called = tokens.filter((t) => t.status === "called");
  const completed = tokens.filter((t) => t.status === "completed");

  return (
    <div className="flex flex-col h-full">
      <div className="mb-4">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900 flex items-center gap-2">
          <Stethoscope size={22} /> Doctor Panel
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1">Today&apos;s consultation queue.</p>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row gap-4 lg:gap-6 min-h-0 border rounded-xl bg-card shadow-sm overflow-hidden">
        {/* Queue list */}
        <div className="w-full lg:w-72 shrink-0 border-b lg:border-b-0 lg:border-r flex flex-col max-h-56 lg:max-h-none">
          <div className="overflow-y-auto flex-1 p-3 space-y-4">
            {isLoading ? (
              <div className="animate-pulse space-y-2">
                {[1, 2, 3].map((i) => <div key={i} className="h-14 bg-muted rounded-lg" />)}
              </div>
            ) : tokens.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No tokens for today.</p>
            ) : (
              [
                { label: "Waiting", list: pending },
                { label: "In Consultation", list: called },
                { label: "Completed", list: completed },
              ].map((group) => group.list.length > 0 && (
                <div key={group.label}>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1 mb-1.5">{group.label}</p>
                  <div className="space-y-1.5">
                    {group.list.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setSelectedTokenId(t.id)}
                        className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                          selectedTokenId === t.id ? "border-primary bg-primary/5 font-semibold" : "hover:bg-muted/50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-sm">#{t.tokenNo}</span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {t.timeSlot && (
                              <span className="text-[10px] text-muted-foreground tabular-nums">
                                {t.timeSlot}
                              </span>
                            )}
                            {queueStatusIcon(t.status)}
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground truncate">{t.patient?.name ?? "--"}</div>
                        {t.status === "completed" && t.calledAt && t.completedAt && (
                          <div className="text-[10px] text-muted-foreground/80 tabular-nums mt-0.5">
                            {formatDuration(durationMinutes(t.calledAt, t.completedAt))}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Workspace */}
        {selectedTokenId ? (
          <ConsultationWorkspace tokenId={selectedTokenId} onCompleted={() => setSelectedTokenId(null)} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-8 text-center">
            Select a token from the queue to begin the consultation.
          </div>
        )}
      </div>
    </div>
  );
}
