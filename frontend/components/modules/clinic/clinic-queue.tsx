"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient, queryKeys } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { useDebounce } from "@/hooks/use-debounce";
import { localDateString } from "@/lib/date";
import { Modal } from "@/components/ui/modal";
import {
  useClinicDoctors,
  useClinicTokens,
  useCreateClinicToken,
  useUpdateClinicToken,
} from "@/queries/clinic.queries";
import { Ticket, Plus, Search, Clock, PhoneCall, CheckCircle2, XCircle } from "lucide-react";

interface Patient { id: string; name: string; phone: string; }
interface Doctor { id: string; firstName?: string; lastName?: string; email: string; }
interface ClinicToken {
  id: string;
  tokenNo: number;
  status: "pending" | "called" | "completed" | "cancelled";
  timeSlot?: string;
  notes?: string;
  patient?: Patient;
  doctor?: Doctor;
  createdAt: string;
}

function doctorName(d?: Doctor) {
  if (!d) return "--";
  return [d.firstName, d.lastName].filter(Boolean).join(" ") || d.email;
}

function statusBadge(status: ClinicToken["status"]) {
  switch (status) {
    case "pending":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 text-xs font-medium">
          <Clock className="w-3 h-3" /> Waiting
        </span>
      );
    case "called":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">
          <PhoneCall className="w-3 h-3" /> In Consultation
        </span>
      );
    case "completed":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">
          <CheckCircle2 className="w-3 h-3" /> Completed
        </span>
      );
    case "cancelled":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-medium">
          <XCircle className="w-3 h-3" /> Cancelled
        </span>
      );
  }
}

function NewTokenModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { success: toastSuccess, error: toastError } = useToast();
  const [patientSearch, setPatientSearch] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [showPatientDropdown, setShowPatientDropdown] = useState(false);
  const [doctorId, setDoctorId] = useState("");
  const [date, setDate] = useState(localDateString());
  const [timeSlot, setTimeSlot] = useState("");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const debouncedPatientSearch = useDebounce(patientSearch, 300);
  const { data: doctorsRes } = useClinicDoctors();
  const doctors: Doctor[] = (doctorsRes as any)?.data ?? [];

  const { data: patientsRes } = useQuery({
    queryKey: ["patient-search-clinic", debouncedPatientSearch],
    queryFn: () => apiClient.get("/patients", { params: { search: debouncedPatientSearch, limit: 10 } }) as Promise<any>,
    enabled: debouncedPatientSearch.length >= 2,
  });
  const patients: Patient[] = (patientsRes as any)?.data ?? [];

  const createMutation = useCreateClinicToken();

  function reset() {
    setPatientSearch("");
    setSelectedPatient(null);
    setDoctorId("");
    setDate(localDateString());
    setTimeSlot("");
    setNotes("");
    setFormError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleSubmit() {
    if (!selectedPatient) { setFormError("Please select a patient."); return; }
    if (!doctorId) { setFormError("Please select a doctor."); return; }
    if (!date) { setFormError("Please select a date."); return; }
    setFormError(null);

    createMutation.mutate(
      {
        patientId: selectedPatient.id,
        doctorId,
        date,
        timeSlot: timeSlot.trim() || undefined,
        notes: notes.trim() || undefined,
      },
      {
        onSuccess: (res: any) => {
          const tokenNo = res?.data?.tokenNo ?? res?.data?.data?.tokenNo;
          toastSuccess("Token generated", tokenNo ? `Token #${tokenNo} issued.` : undefined);
          handleClose();
        },
        onError: (err: any) => {
          const message = err?.response?.data?.message ?? "Failed to generate token.";
          setFormError(message);
          toastError("Could not generate token", message);
        },
      },
    );
  }

  return (
    <Modal title="New Token" subtitle="Register a patient for a doctor consultation" icon={<Ticket size={16} />} open={open} onClose={handleClose} size="lg">
      <div className="px-6 py-5 space-y-5">
        <div className="space-y-1">
          <label className="text-sm font-medium">Patient <span className="text-red-500">*</span></label>
          {selectedPatient ? (
            <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              <div>
                <span className="font-medium text-sm">{selectedPatient.name}</span>
                <span className="text-muted-foreground text-xs ml-2">{selectedPatient.phone}</span>
              </div>
              <button onClick={() => { setSelectedPatient(null); setPatientSearch(""); }} className="text-xs text-red-500 hover:underline">
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
                  {patients.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => { setSelectedPatient(p); setShowPatientDropdown(false); setPatientSearch(""); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors flex items-center justify-between"
                    >
                      <span className="font-medium">{p.name}</span>
                      <span className="text-muted-foreground text-xs">{p.phone}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">Doctor <span className="text-red-500">*</span></label>
          <select
            value={doctorId}
            onChange={(e) => setDoctorId(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-background"
          >
            <option value="">Select a doctor...</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>{doctorName(d)}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Date <span className="text-red-500">*</span></label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Time Slot</label>
            <input
              type="text"
              value={timeSlot}
              onChange={(e) => setTimeSlot(e.target.value)}
              placeholder="10:00 AM - 10:30 AM"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">Notes</label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Reason for visit, symptoms..."
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
          />
        </div>

        {formError && (
          <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={handleClose} className="px-4 py-2 border rounded-lg text-sm font-medium hover:bg-muted transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={createMutation.isPending}
            className="flex items-center gap-2 px-5 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {createMutation.isPending ? (
              <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Generating...</>
            ) : (
              <><Ticket size={14} /> Generate Token</>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function ClinicQueue() {
  const qc = useQueryClient();
  const { error: toastError, success: toastSuccess } = useToast();
  const [date] = useState(localDateString());
  const [doctorFilter, setDoctorFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const { data: doctorsRes } = useClinicDoctors();
  const doctors: Doctor[] = (doctorsRes as any)?.data ?? [];

  const params = { date, doctorId: doctorFilter || undefined, limit: 100 };
  const { data: tokensRes, isLoading } = useClinicTokens(params);
  const tokensRaw = (tokensRes as any)?.data;
  const tokens: ClinicToken[] = Array.isArray(tokensRaw) ? tokensRaw : Array.isArray(tokensRaw?.data) ? tokensRaw.data : [];

  const updateMutation = useUpdateClinicToken("");

  function cancelToken(id: string) {
    apiClient
      .patch(`/clinic/tokens/${id}`, { status: "cancelled" })
      .then(() => {
        qc.invalidateQueries({ queryKey: queryKeys.clinicTokens.all() });
        toastSuccess("Token cancelled");
      })
      .catch((err: any) => toastError("Could not cancel token", err?.response?.data?.message));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Clinic Queue</h1>
          <p className="text-muted-foreground mt-1">Generate and track today&apos;s doctor consultation tokens.</p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus size={16} /> New Token
        </button>
      </div>

      <div className="flex items-center gap-3">
        <select
          value={doctorFilter}
          onChange={(e) => setDoctorFilter(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">All Doctors</option>
          {doctors.map((d) => (
            <option key={d.id} value={d.id}>{doctorName(d)}</option>
          ))}
        </select>
        <span className="text-sm text-muted-foreground">{date}</span>
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-muted rounded-xl" />)}
        </div>
      ) : tokens.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Ticket className="mx-auto mb-3 opacity-30" size={48} />
          <p className="font-medium">No tokens generated for this day yet.</p>
        </div>
      ) : (
        <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 text-muted-foreground font-medium border-b">
                <tr>
                  <th className="px-6 py-4">Token</th>
                  <th className="px-6 py-4">Patient</th>
                  <th className="px-6 py-4">Doctor</th>
                  <th className="px-6 py-4">Time Slot</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {tokens.map((t) => (
                  <tr key={t.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-4 font-semibold">#{t.tokenNo}</td>
                    <td className="px-6 py-4">
                      <div className="font-medium">{t.patient?.name ?? "--"}</div>
                      <div className="text-xs text-muted-foreground">{t.patient?.phone ?? ""}</div>
                    </td>
                    <td className="px-6 py-4">{doctorName(t.doctor)}</td>
                    <td className="px-6 py-4 text-muted-foreground">{t.timeSlot ?? "--"}</td>
                    <td className="px-6 py-4">{statusBadge(t.status)}</td>
                    <td className="px-6 py-4 text-right">
                      {(t.status === "pending" || t.status === "called") && (
                        <button
                          onClick={() => cancelToken(t.id)}
                          disabled={updateMutation.isPending}
                          className="text-xs text-red-600 hover:underline disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <NewTokenModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
