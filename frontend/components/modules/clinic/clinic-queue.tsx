"use client";

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient, queryKeys } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { useDebounce } from "@/hooks/use-debounce";
import { localDateString } from "@/lib/date";
import { useActiveBranchId } from "@/hooks/use-branch";
import { Modal } from "@/components/ui/modal";
import {
  useClinicDoctors,
  useClinicTokens,
  useCreateClinicToken,
  useUpdateClinicToken,
} from "@/queries/clinic.queries";
import { useAuthStore } from "@/stores/auth.store";
import {
  Ticket,
  Plus,
  Search,
  Clock,
  PhoneCall,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  UserPlus,
  Stethoscope,
  MapPin,
  Calendar,
  DollarSign,
  Users,
  UserCheck,
  ChevronRight,
  Filter,
  Sparkles,
  Edit,
  Building2,
} from "lucide-react";
import { useBranches, rowsOf } from "@/queries/admin.queries";
import { QuickPatientForm } from "@/components/modules/patients/quick-patient-form";
import { formatClockTime, formatDuration, durationMinutes } from "@/lib/consultation-time";

interface Patient {
  id: string;
  name: string;
  phone: string;
}

interface Doctor {
  id: string;
  firstName?: string;
  lastName?: string;
  email: string;
  specialty?: string;
  branchId?: string | null;
  doctorProfile?: {
    specialty?: string;
    opdRoom?: string;
    consultationFee?: number | string;
    regNo?: string;
    phone?: string;
    weeklySchedule?: { days: string; slots: string }[];
    availabilityStatus?: string;
  } | null;
}

interface ClinicToken {
  id: string;
  tokenNo: number;
  status: "pending" | "called" | "completed" | "cancelled";
  timeSlot?: string;
  notes?: string;
  patient?: Patient;
  doctor?: Doctor;
  calledAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
}

interface DoctorSchedule {
  specialty: string;
  opdRoom: string;
  fee: string;
  colorTheme: "emerald" | "blue" | "purple" | "amber" | "rose";
  badgeBg: string;
  badgeText: string;
  weeklySchedule: {
    days: string;
    slots: string;
  }[];
}

const DOCTOR_PRESETS: DoctorSchedule[] = [
  {
    specialty: "General Medicine & Primary Care",
    opdRoom: "OPD Cabin 101 (Ground Floor)",
    fee: "₹400",
    colorTheme: "emerald",
    badgeBg: "bg-emerald-50 border-emerald-200",
    badgeText: "text-emerald-700",
    weeklySchedule: [
      { days: "Mon - Fri", slots: "09:00 AM - 01:00 PM & 04:00 PM - 07:00 PM" },
      { days: "Saturday", slots: "09:00 AM - 02:00 PM" },
    ],
  },
  {
    specialty: "Cardiology & Heart Care",
    opdRoom: "OPD Cabin 102 (1st Floor)",
    fee: "₹600",
    colorTheme: "blue",
    badgeBg: "bg-blue-50 border-blue-200",
    badgeText: "text-blue-700",
    weeklySchedule: [
      { days: "Mon, Wed, Fri", slots: "10:00 AM - 02:00 PM" },
      { days: "Tue, Thu", slots: "03:00 PM - 07:00 PM" },
      { days: "Saturday", slots: "10:00 AM - 01:00 PM" },
    ],
  },
  {
    specialty: "Pediatrics & Child Health",
    opdRoom: "OPD Cabin 103 (1st Floor)",
    fee: "₹500",
    colorTheme: "purple",
    badgeBg: "bg-purple-50 border-purple-200",
    badgeText: "text-purple-700",
    weeklySchedule: [
      { days: "Mon - Sat", slots: "09:30 AM - 01:30 PM" },
      { days: "Sun", slots: "On Call Emergency Only" },
    ],
  },
  {
    specialty: "Orthopedics & Joint Care",
    opdRoom: "OPD Cabin 104 (2nd Floor)",
    fee: "₹550",
    colorTheme: "amber",
    badgeBg: "bg-amber-50 border-amber-200",
    badgeText: "text-amber-700",
    weeklySchedule: [
      { days: "Tue, Thu, Sat", slots: "11:00 AM - 04:00 PM" },
      { days: "Mon, Wed", slots: "05:00 PM - 08:00 PM" },
    ],
  },
  {
    specialty: "Dermatology & Skin Care",
    opdRoom: "OPD Cabin 105 (2nd Floor)",
    fee: "₹500",
    colorTheme: "rose",
    badgeBg: "bg-rose-50 border-rose-200",
    badgeText: "text-rose-700",
    weeklySchedule: [
      { days: "Mon, Wed, Fri", slots: "02:00 PM - 06:00 PM" },
      { days: "Saturday", slots: "10:00 AM - 02:00 PM" },
    ],
  },
];

function getDoctorSchedule(d?: Doctor, index = 0): DoctorSchedule {
  const preset = DOCTOR_PRESETS[index % DOCTOR_PRESETS.length]!;
  if (!d?.doctorProfile) return preset;

  const dp = d.doctorProfile;
  return {
    specialty: dp.specialty || preset.specialty,
    opdRoom: dp.opdRoom || preset.opdRoom,
    fee: dp.consultationFee ? `₹${dp.consultationFee}` : preset.fee,
    colorTheme: preset.colorTheme,
    badgeBg: preset.badgeBg,
    badgeText: preset.badgeText,
    weeklySchedule: dp.weeklySchedule?.length ? dp.weeklySchedule : preset.weeklySchedule,
  };
}

function doctorName(d?: Doctor) {
  if (!d) return "--";
  const name = [d.firstName, d.lastName].filter(Boolean).join(" ");
  return name ? `Dr. ${name}` : d.email;
}

function statusBadge(status: ClinicToken["status"]) {
  switch (status) {
    case "pending":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-xs font-semibold">
          <Clock className="w-3 h-3" /> Waiting
        </span>
      );
    case "called":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-xs font-semibold animate-pulse">
          <PhoneCall className="w-3 h-3" /> In Consultation
        </span>
      );
    case "completed":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold">
          <CheckCircle2 className="w-3 h-3" /> Completed
        </span>
      );
    case "cancelled":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-xs font-semibold">
          <XCircle className="w-3 h-3" /> Cancelled
        </span>
      );
  }
}

export function EditDoctorProfileModal({
  open,
  onClose,
  doctor,
}: {
  open: boolean;
  onClose: () => void;
  doctor: Doctor | null;
}) {
  const qc = useQueryClient();
  const { success: toastSuccess, error: toastError } = useToast();
  const { data: branchesRaw } = useBranches();
  const branches = rowsOf<any>(branchesRaw);

  const { user: currentUser } = useAuthStore();
  const isAdmin = currentUser?.role === "admin" || currentUser?.role === "super_admin";

  const dp = doctor?.doctorProfile;
  const sched = dp?.weeklySchedule ?? [];

  const [branchId, setBranchId] = useState(doctor?.branchId ?? "");
  const [specialty, setSpecialty] = useState("General Medicine & Primary Care");
  const [fee, setFee] = useState("400");
  const [opdRoom, setOpdRoom] = useState("OPD Cabin 101 (Ground Floor)");
  const [regNo, setRegNo] = useState("");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState("available");
  const [slot1Days, setSlot1Days] = useState("Mon - Fri");
  const [slot1Hours, setSlot1Hours] = useState("09:00 AM - 01:00 PM & 04:00 PM - 07:00 PM");
  const [slot2Days, setSlot2Days] = useState("Saturday");
  const [slot2Hours, setSlot2Hours] = useState("09:00 AM - 02:00 PM");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (doctor) {
      const dProfile = doctor.doctorProfile;
      const sList = dProfile?.weeklySchedule ?? [];
      setBranchId(doctor.branchId ?? "");
      setSpecialty(dProfile?.specialty ?? "General Medicine & Primary Care");
      setFee(dProfile?.consultationFee ? String(dProfile.consultationFee) : "400");
      setOpdRoom(dProfile?.opdRoom ?? "OPD Cabin 101 (Ground Floor)");
      setRegNo(dProfile?.regNo ?? "");
      setPhone(dProfile?.phone ?? "");
      setStatus(dProfile?.availabilityStatus ?? "available");
      setSlot1Days(sList[0]?.days ?? "Mon - Fri");
      setSlot1Hours(sList[0]?.slots ?? "09:00 AM - 01:00 PM & 04:00 PM - 07:00 PM");
      setSlot2Days(sList[1]?.days ?? "Saturday");
      setSlot2Hours(sList[1]?.slots ?? "09:00 AM - 02:00 PM");
    }
  }, [doctor]);

  if (!doctor) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    const profileData = {
      ...(isAdmin ? { branchId: branchId === "" ? null : branchId } : {}),
      specialty: specialty.trim() || "General Medicine & Primary Care",
      consultationFee: parseFloat(fee) || 400,
      opdRoom: opdRoom.trim() || "OPD Cabin 101 (Ground Floor)",
      regNo: regNo.trim() || undefined,
      phone: phone.trim() || undefined,
      availabilityStatus: status,
      weeklySchedule: [
        { days: slot1Days || "Mon - Fri", slots: slot1Hours || "09:00 AM - 01:00 PM & 04:00 PM - 07:00 PM" },
        ...(slot2Days ? [{ days: slot2Days, slots: slot2Hours || "09:00 AM - 02:00 PM" }] : []),
      ],
    };

    apiClient
      .patch(`/clinic/doctors/${doctor.id}/profile`, profileData)
      .then(() => {
        qc.invalidateQueries({ queryKey: queryKeys.clinicTokens.doctors() });
        toastSuccess("Doctor Profile Updated", `${doctorName(doctor)} OPD profile and timings updated.`);
        onClose();
      })
      .catch((err: any) => {
        toastError("Could not update profile", err?.response?.data?.message ?? "An error occurred.");
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <Modal
      title={`Edit Doctor Profile — ${doctorName(doctor)}`}
      subtitle="Update assigned OPD branch clinic, specialization, consultation fee, cabin & weekly timings"
      icon={<Edit size={18} className="text-emerald-600" />}
      open={open}
      onClose={onClose}
      size="lg"
    >
      <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
        {/* Branch Mapping Selector */}
        <div className="bg-emerald-50/60 border border-emerald-200/80 rounded-xl p-3.5 space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-xs font-black text-emerald-900 uppercase tracking-wider block flex items-center gap-1.5">
              <Building2 size={14} className="text-emerald-600 shrink-0" />
              Assigned OPD Branch / Clinic Location
            </label>
            {!isAdmin && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-200 text-slate-700">
                Managed by Admin
              </span>
            )}
          </div>
          <select
            value={branchId}
            disabled={!isAdmin}
            onChange={(e) => setBranchId(e.target.value)}
            className={`w-full border rounded-xl px-3 py-2 text-xs font-bold ${
              !isAdmin
                ? "bg-slate-100 border-slate-300 text-slate-600 cursor-not-allowed"
                : "bg-white border-emerald-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            }`}
          >
            <option value="">No branch / All branches (Unassigned)</option>
            {branches.map((b: any) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.code || "Branch"})
              </option>
            ))}
          </select>
          <p className="text-[11px] text-emerald-700 font-medium">
            {isAdmin
              ? "Mapping this doctor to a branch assigns their primary OPD clinic for patient tokens, queue scheduling, and branch-scoped views."
              : "Your primary OPD Branch location is assigned by Super Admins & Clinic Managers. Your live inventory and prescriptions automatically align with this OPD Branch."}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div>
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
              Medical Specialization / Department
            </label>
            <select
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 text-slate-800 font-medium"
            >
              <option value="General Medicine & Primary Care">General Medicine & Primary Care</option>
              <option value="Cardiology & Heart Care">Cardiology & Heart Care</option>
              <option value="Pediatrics & Child Health">Pediatrics & Child Health</option>
              <option value="Orthopedics & Joint Care">Orthopedics & Joint Care</option>
              <option value="Dermatology & Skin Care">Dermatology & Skin Care</option>
              <option value="Gynecology & Women's Health">Gynecology & Women&apos;s Health</option>
              <option value="ENT & Head/Neck">ENT & Head/Neck</option>
              <option value="Neurology & Brain Health">Neurology & Brain Health</option>
              <option value="Psychiatry & Behavioral Health">Psychiatry & Behavioral Health</option>
              <option value="Dentistry & Dental Care">Dentistry & Dental Care</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
              Consultation Fee (₹)
            </label>
            <input
              type="number"
              min="0"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 text-slate-800 font-medium"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
              OPD Cabin / Room Location
            </label>
            <input
              type="text"
              value={opdRoom}
              onChange={(e) => setOpdRoom(e.target.value)}
              placeholder="e.g. OPD Cabin 101 (Ground Floor)"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 text-slate-800"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
              Medical License / Reg No.
            </label>
            <input
              type="text"
              value={regNo}
              onChange={(e) => setRegNo(e.target.value)}
              placeholder="e.g. MCI-2024-88910"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 text-slate-800"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
              Doctor Direct Phone
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. +91 9876543210"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 text-slate-800"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
              Availability Status
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 text-slate-800 font-medium"
            >
              <option value="available">Available Today</option>
              <option value="on_call">On Call / Emergency</option>
              <option value="on_leave">On Leave</option>
              <option value="busy">Busy / In Surgery</option>
            </select>
          </div>
        </div>

        <div className="space-y-2 pt-2 border-t border-slate-100">
          <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
            Weekly OPD Timings & Duty Roster
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-[10px] text-slate-500 font-semibold block mb-0.5">Slot 1 Days</span>
              <input
                type="text"
                value={slot1Days}
                onChange={(e) => setSlot1Days(e.target.value)}
                placeholder="Mon - Fri"
                className="w-full border border-slate-200 rounded-xl px-3 py-1.5 text-xs bg-white"
              />
            </div>
            <div>
              <span className="text-[10px] text-slate-500 font-semibold block mb-0.5">Slot 1 Hours</span>
              <input
                type="text"
                value={slot1Hours}
                onChange={(e) => setSlot1Hours(e.target.value)}
                placeholder="09:00 AM - 01:00 PM & 04:00 PM - 07:00 PM"
                className="w-full border border-slate-200 rounded-xl px-3 py-1.5 text-xs bg-white"
              />
            </div>
            <div>
              <span className="text-[10px] text-slate-500 font-semibold block mb-0.5">Slot 2 Days (Optional)</span>
              <input
                type="text"
                value={slot2Days}
                onChange={(e) => setSlot2Days(e.target.value)}
                placeholder="Saturday"
                className="w-full border border-slate-200 rounded-xl px-3 py-1.5 text-xs bg-white"
              />
            </div>
            <div>
              <span className="text-[10px] text-slate-500 font-semibold block mb-0.5">Slot 2 Hours (Optional)</span>
              <input
                type="text"
                value={slot2Hours}
                onChange={(e) => setSlot2Hours(e.target.value)}
                placeholder="09:00 AM - 02:00 PM"
                className="w-full border border-slate-200 rounded-xl px-3 py-1.5 text-xs bg-white"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-md transition-all disabled:opacity-50"
          >
            {submitting ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Saving Profile...
              </>
            ) : (
              <>
                <CheckCircle2 size={15} /> Save Doctor Profile
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function NewTokenModal({
  open,
  onClose,
  defaultDoctorId,
}: {
  open: boolean;
  onClose: () => void;
  defaultDoctorId?: string;
}) {
  const { success: toastSuccess, error: toastError } = useToast();
  const [patientSearch, setPatientSearch] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [showPatientDropdown, setShowPatientDropdown] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [doctorId, setDoctorId] = useState(defaultDoctorId ?? "");
  const [date, setDate] = useState(localDateString());
  const [timeSlot, setTimeSlot] = useState("");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const debouncedPatientSearch = useDebounce(patientSearch, 300);
  const { data: doctorsRes } = useClinicDoctors();
  const doctors: Doctor[] = (doctorsRes as any)?.data ?? [];

  const { data: patientsRes } = useQuery({
    queryKey: ["patient-search-clinic", debouncedPatientSearch],
    queryFn: () =>
      apiClient.get("/patients", {
        params: { search: debouncedPatientSearch, limit: 10 },
      }) as Promise<any>,
    enabled: debouncedPatientSearch.length >= 2,
  });
  const patients: Patient[] = (patientsRes as any)?.data ?? [];

  const createMutation = useCreateClinicToken();
  const { branchId, needsSelection: needsBranchSelection } = useActiveBranchId();

  const { data: takenRes } = useQuery({
    queryKey: ["clinic-taken-slots", doctorId, date],
    queryFn: () =>
      apiClient.get("/clinic/tokens/taken-slots", {
        params: { doctorId, date },
      }) as Promise<any>,
    enabled: !!doctorId && !!date,
  });
  const takenSlots: string[] = (() => {
    const d = (takenRes as any)?.data ?? takenRes;
    const rows = Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : [];
    return rows.map((r: any) => r.timeSlot).filter(Boolean);
  })();
  const slotTaken =
    !!timeSlot.trim() &&
    takenSlots.some((s) => s.toLowerCase() === timeSlot.trim().toLowerCase());

  function reset() {
    setPatientSearch("");
    setSelectedPatient(null);
    setRegistering(false);
    setDoctorId(defaultDoctorId ?? "");
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
    if (!selectedPatient) {
      setFormError("Please select a patient.");
      return;
    }
    if (!doctorId) {
      setFormError("Please select a doctor.");
      return;
    }
    if (!date) {
      setFormError("Please select a date.");
      return;
    }
    if (needsBranchSelection) {
      setFormError("Select an active branch from the header before generating a token.");
      return;
    }
    if (slotTaken) {
      setFormError(`${timeSlot.trim()} is already booked with this doctor. Choose another slot.`);
      return;
    }
    setFormError(null);

    createMutation.mutate(
      {
        patientId: selectedPatient.id,
        doctorId,
        date,
        timeSlot: timeSlot.trim() || undefined,
        notes: notes.trim() || undefined,
        branchId,
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
    <Modal
      title="Issue Consultation Token"
      subtitle="Register patient for doctor OPD consultation"
      icon={<Ticket size={18} className="text-emerald-600" />}
      open={open}
      onClose={handleClose}
      size="lg"
    >
      <div className="px-6 py-5 space-y-5">
        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            Patient <span className="text-rose-500">*</span>
          </label>
          {selectedPatient ? (
            <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-3.5 py-2.5 shadow-2xs">
              <div>
                <span className="font-bold text-sm text-slate-800">{selectedPatient.name}</span>
                <span className="text-slate-500 text-xs ml-2 font-mono">{selectedPatient.phone}</span>
              </div>
              <button
                onClick={() => {
                  setSelectedPatient(null);
                  setPatientSearch("");
                }}
                className="text-xs font-semibold text-rose-600 hover:text-rose-800 transition-colors"
              >
                Change Patient
              </button>
            </div>
          ) : registering ? (
            <QuickPatientForm
              initialQuery={patientSearch}
              onCreated={(p) => {
                setSelectedPatient(p);
                setRegistering(false);
                setPatientSearch("");
                setFormError(null);
              }}
              onCancel={() => setRegistering(false)}
            />
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search by patient name or phone..."
                  value={patientSearch}
                  onChange={(e) => {
                    setPatientSearch(e.target.value);
                    setShowPatientDropdown(true);
                  }}
                  onFocus={() => setShowPatientDropdown(true)}
                  className="w-full border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition shadow-2xs"
                />
                {showPatientDropdown && patients.length > 0 && (
                  <div className="absolute z-20 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-48 overflow-y-auto divide-y divide-slate-100">
                    {patients.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setSelectedPatient(p);
                          setShowPatientDropdown(false);
                          setPatientSearch("");
                        }}
                        className="w-full text-left px-3.5 py-2.5 text-sm hover:bg-emerald-50/60 transition-colors flex items-center justify-between"
                      >
                        <span className="font-semibold text-slate-800">{p.name}</span>
                        <span className="text-slate-500 text-xs font-mono">{p.phone}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {debouncedPatientSearch.length >= 2 && patients.length === 0 ? (
                <div className="flex items-center justify-between gap-2 border border-dashed border-slate-300 bg-slate-50/50 rounded-xl px-3.5 py-2.5">
                  <span className="text-xs text-slate-500">
                    No matching patient for &quot;{patientSearch.trim()}&quot;.
                  </span>
                  <button
                    type="button"
                    onClick={() => setRegistering(true)}
                    className="flex items-center gap-1 text-xs font-bold text-emerald-700 hover:text-emerald-900 transition-colors shrink-0"
                  >
                    <UserPlus size={13} /> Register New Patient
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setRegistering(true)}
                  className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 hover:text-emerald-800 transition-colors"
                >
                  <UserPlus size={13} /> Register New Patient Inline
                </button>
              )}
            </div>
          )}
        </div>

        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            Consulting Doctor <span className="text-rose-500">*</span>
          </label>
          <select
            value={doctorId}
            onChange={(e) => setDoctorId(e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition font-medium text-slate-800"
          >
            <option value="">Select consulting doctor...</option>
            {doctors.map((d, i) => {
              const sched = getDoctorSchedule(d, i);
              return (
                <option key={d.id} value={d.id}>
                  {doctorName(d)} — {sched.specialty} ({sched.opdRoom})
                </option>
              );
            })}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Consultation Date <span className="text-rose-500">*</span>
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition text-slate-800"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Time Slot</label>
            <select
              value={timeSlot}
              onChange={(e) => setTimeSlot(e.target.value)}
              className={`w-full border rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition text-slate-800 ${
                slotTaken ? "border-rose-400 bg-rose-50/40" : "border-slate-200"
              }`}
            >
              <option value="">Select slot (Optional)...</option>
              {TIME_SLOT_OPTIONS.map((slot) => {
                const isTaken = takenSlots.some((s) => s.toLowerCase() === slot.toLowerCase());
                return (
                  <option key={slot} value={slot} disabled={isTaken}>
                    {slot} {isTaken ? "(Booked)" : ""}
                  </option>
                );
              })}
            </select>
            {slotTaken ? (
              <p className="text-[11px] text-rose-600 font-medium flex items-center gap-1 mt-1">
                <AlertTriangle size={12} /> Slot already booked with this doctor.
              </p>
            ) : takenSlots.length > 0 ? (
              <p className="text-[11px] text-slate-500 font-mono mt-1">
                Booked: {takenSlots.join(", ")}
              </p>
            ) : null}
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Chief Complaint / Visit Notes</label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Key symptoms, reason for visit, or referral notes..."
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition resize-none text-slate-800"
          />
        </div>

        {formError && (
          <div className="text-rose-700 text-xs font-bold bg-rose-50 border border-rose-200 rounded-xl px-3.5 py-2.5">
            {formError}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button
            onClick={handleClose}
            className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={createMutation.isPending}
            className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-md transition-all disabled:opacity-50"
          >
            {createMutation.isPending ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Issuing Token...
              </>
            ) : (
              <>
                <Ticket size={15} /> Issue Consultation Token
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}

const TIME_SLOT_OPTIONS = [
  "09:00 AM - 09:30 AM",
  "09:30 AM - 10:00 AM",
  "10:00 AM - 10:30 AM",
  "10:30 AM - 11:00 AM",
  "11:00 AM - 11:30 AM",
  "11:30 AM - 12:00 PM",
  "04:00 PM - 04:30 PM",
  "04:30 PM - 05:00 PM",
  "05:00 PM - 05:30 PM",
  "05:30 PM - 06:00 PM",
  "06:00 PM - 06:30 PM",
  "06:30 PM - 07:00 PM",
];

export function ClinicQueue() {
  const qc = useQueryClient();
  const { error: toastError, success: toastSuccess } = useToast();
  const [date, setDate] = useState(localDateString());
  const [doctorFilter, setDoctorFilter] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editingDoctor, setEditingDoctor] = useState<Doctor | null>(null);
  const [preselectedDoctorId, setPreselectedDoctorId] = useState<string | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<"overview" | "roster" | "queue">("overview");

  const { data: doctorsRes } = useClinicDoctors();
  const doctors: Doctor[] = (doctorsRes as any)?.data ?? [];

  const params = { date, doctorId: doctorFilter || undefined, limit: 100 };
  const { data: tokensRes, isLoading } = useClinicTokens(params);
  const tokensRaw = (tokensRes as any)?.data;
  const tokens: ClinicToken[] = Array.isArray(tokensRaw)
    ? tokensRaw
    : Array.isArray(tokensRaw?.data)
    ? tokensRaw.data
    : [];

  const updateMutation = useUpdateClinicToken("");

  function cancelToken(id: string) {
    apiClient
      .patch(`/clinic/tokens/${id}`, { status: "cancelled" })
      .then(() => {
        qc.invalidateQueries({ queryKey: queryKeys.clinicTokens.all() });
        toastSuccess("Token cancelled");
      })
      .catch((err: any) =>
        toastError("Could not cancel token", err?.response?.data?.message),
      );
  }

  function callPatient(id: string) {
    apiClient
      .patch(`/clinic/tokens/${id}`, { status: "called", calledAt: new Date().toISOString() })
      .then(() => {
        qc.invalidateQueries({ queryKey: queryKeys.clinicTokens.all() });
        toastSuccess("Patient called in for consultation");
      })
      .catch((err: any) =>
        toastError("Could not call patient", err?.response?.data?.message),
      );
  }

  function completeConsultation(id: string) {
    apiClient
      .patch(`/clinic/tokens/${id}`, { status: "completed", completedAt: new Date().toISOString() })
      .then(() => {
        qc.invalidateQueries({ queryKey: queryKeys.clinicTokens.all() });
        toastSuccess("Consultation marked completed");
      })
      .catch((err: any) =>
        toastError("Could not complete token", err?.response?.data?.message),
      );
  }

  // Filtered doctors list for search
  const filteredDoctors = doctors.filter((d, i) => {
    const sched = getDoctorSchedule(d, i);
    const name = doctorName(d).toLowerCase();
    const spec = sched.specialty.toLowerCase();
    const query = searchFilter.toLowerCase();
    return !query || name.includes(query) || spec.includes(query);
  });

  // Calculate metrics summary
  const totalTokensToday = tokens.length;
  const waitingTokens = tokens.filter((t) => t.status === "pending").length;
  const calledTokens = tokens.filter((t) => t.status === "called").length;
  const completedTokens = tokens.filter((t) => t.status === "completed").length;

  const openNewTokenForDoctor = (docId?: string) => {
    setPreselectedDoctorId(docId);
    setCreateOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-slate-900 via-slate-800 to-teal-950 p-6 rounded-2xl text-white shadow-xl">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 rounded-full border border-emerald-500/30">
              Front Desk OPD Portal
            </span>
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
            <Stethoscope className="text-emerald-400 shrink-0" size={26} />
            Clinic Queue & Doctor Timings
          </h1>
          <p className="text-slate-300 text-xs font-medium mt-1">
            Live doctor availability, OPD room schedules, and token desk queue management.
          </p>
        </div>
        <button
          onClick={() => openNewTokenForDoctor()}
          className="flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-xs rounded-xl shadow-lg transition-all hover:scale-105 active:scale-95 shrink-0"
        >
          <Plus size={16} className="stroke-[3]" /> Issue New Token
        </button>
      </div>

      {/* Overview Metrics Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200/80 p-4 rounded-2xl shadow-2xs flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Available Doctors</p>
            <p className="text-2xl font-black text-slate-800 mt-1">{doctors.length || 4}</p>
            <p className="text-[10px] font-semibold text-emerald-600 mt-0.5 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> On duty today
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <Users size={20} />
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 p-4 rounded-2xl shadow-2xs flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Patients Waiting</p>
            <p className="text-2xl font-black text-amber-600 mt-1">{waitingTokens}</p>
            <p className="text-[10px] font-semibold text-slate-500 mt-0.5">Tokens in queue</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <Clock size={20} />
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 p-4 rounded-2xl shadow-2xs flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Serving Now</p>
            <p className="text-2xl font-black text-blue-600 mt-1">{calledTokens}</p>
            <p className="text-[10px] font-semibold text-blue-600 mt-0.5">In consultation</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <PhoneCall size={20} />
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 p-4 rounded-2xl shadow-2xs flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Completed Today</p>
            <p className="text-2xl font-black text-emerald-600 mt-1">{completedTokens}</p>
            <p className="text-[10px] font-semibold text-emerald-600 mt-0.5">Finished tokens</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <UserCheck size={20} />
          </div>
        </div>
      </div>

      {/* Main View Switcher & Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="flex items-center gap-1.5 p-1 bg-slate-100/80 rounded-xl w-fit">
          <button
            onClick={() => setActiveTab("overview")}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all ${
              activeTab === "overview"
                ? "bg-white text-slate-900 shadow-2xs"
                : "text-slate-500 hover:text-slate-900"
            }`}
          >
            Overview & Schedule
          </button>
          <button
            onClick={() => setActiveTab("roster")}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all ${
              activeTab === "roster"
                ? "bg-white text-slate-900 shadow-2xs"
                : "text-slate-500 hover:text-slate-900"
            }`}
          >
            Doctor Timetables ({doctors.length || 4})
          </button>
          <button
            onClick={() => setActiveTab("queue")}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all ${
              activeTab === "queue"
                ? "bg-white text-slate-900 shadow-2xs"
                : "text-slate-500 hover:text-slate-900"
            }`}
          >
            Live Patient Queue ({tokens.length})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search doctor or specialty..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="border border-slate-200/80 rounded-xl pl-8 pr-3 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition w-48 sm:w-60 font-medium"
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              value={doctorFilter}
              onChange={(e) => setDoctorFilter(e.target.value)}
              className="border border-slate-200/80 rounded-xl px-3 py-1.5 text-xs bg-white font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            >
              <option value="">All Consulting Doctors</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {doctorName(d)}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="border border-slate-200/80 rounded-xl px-3 py-1.5 text-xs bg-white font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
          </div>
        </div>
      </div>

      {/* SECTION 1: Doctor Roster & Timings Schedule Cards */}
      {(activeTab === "overview" || activeTab === "roster") && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
              <Calendar size={18} className="text-emerald-600" />
              Doctor Duty Roster & OPD Weekly Timings
            </h2>
            <span className="text-xs text-slate-500 font-medium">
              Showing availability for front desk token generation
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredDoctors.map((doc, idx) => {
              const sched = getDoctorSchedule(doc, idx);
              const name = doctorName(doc);
              const docTokens = tokens.filter(
                (t) => t.doctor?.id === doc.id || t.doctor?.email === doc.email,
              );
              const docWaiting = docTokens.filter((t) => t.status === "pending").length;
              const availStatus = doc.doctorProfile?.availabilityStatus ?? "available";

              return (
                <div
                  key={doc.id}
                  className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs hover:shadow-md transition-all duration-200 flex flex-col justify-between overflow-hidden group"
                >
                  <div className="p-4 space-y-3">
                    {/* Header: Avatar, Name, Specialty Badge */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-slate-900 to-teal-900 text-emerald-400 font-black text-sm flex items-center justify-center shadow-sm shrink-0 border border-slate-800">
                          {name.replace("Dr. ", "").slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <h3 className="font-extrabold text-slate-900 text-sm group-hover:text-emerald-700 transition-colors">
                              {name}
                            </h3>
                            <button
                              onClick={() => setEditingDoctor(doc)}
                              className="text-slate-400 hover:text-emerald-600 transition-colors p-0.5 rounded"
                              title="Edit Doctor Profile & OPD Timings"
                            >
                              <Edit size={13} />
                            </button>
                          </div>
                          <span
                            className={`inline-block mt-0.5 text-[10px] font-extrabold px-2 py-0.5 rounded-full border ${sched.badgeBg} ${sched.badgeText}`}
                          >
                            {sched.specialty}
                          </span>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="text-xs font-black text-slate-800 block">
                          {sched.fee}
                        </span>
                        <span className="text-[10px] font-bold text-slate-400 uppercase">
                          Consult Fee
                        </span>
                      </div>
                    </div>

                    {/* Room & Status */}
                    <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
                      <div className="flex items-center gap-1.5 text-slate-600 font-medium">
                        <MapPin size={13} className="text-slate-400 shrink-0" />
                        <span>{sched.opdRoom}</span>
                      </div>
                      <div className={`flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md border ${
                        availStatus === "on_leave"
                          ? "bg-rose-50 text-rose-700 border-rose-200"
                          : availStatus === "on_call"
                          ? "bg-amber-50 text-amber-700 border-amber-200"
                          : availStatus === "busy"
                          ? "bg-purple-50 text-purple-700 border-purple-200"
                          : "bg-emerald-50 text-emerald-700 border-emerald-200/60"
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          availStatus === "on_leave" ? "bg-rose-500" : availStatus === "on_call" ? "bg-amber-500 animate-pulse" : "bg-emerald-500 animate-pulse"
                        }`} />
                        {availStatus === "on_leave" ? "On Leave" : availStatus === "on_call" ? "On Call / Emergency" : availStatus === "busy" ? "Busy / In Surgery" : "Available Today"}
                      </div>
                    </div>

                    {/* Weekly Schedule list */}
                    <div className="space-y-1.5 bg-slate-50/70 p-3 rounded-xl border border-slate-100">
                      <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1">
                        <Clock size={11} /> Weekly OPD Timings
                      </p>
                      {sched.weeklySchedule.map((s, sIdx) => (
                        <div
                          key={sIdx}
                          className="flex items-center justify-between text-[11px] font-medium"
                        >
                          <span className="font-bold text-slate-700">{s.days}:</span>
                          <span className="text-slate-600 font-mono">{s.slots}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Card Footer Action */}
                  <div className="p-3 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between">
                    <div className="text-[11px] font-semibold text-slate-500">
                      Waiting: <span className="font-extrabold text-slate-900">{docWaiting} patients</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setEditingDoctor(doc)}
                        className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all border border-slate-200"
                        title="Edit Doctor Profile & OPD Timings"
                      >
                        <Edit size={12} /> Edit
                      </button>
                      <button
                        onClick={() => openNewTokenForDoctor(doc.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-emerald-600 text-white text-xs font-bold rounded-xl transition-all shadow-2xs"
                      >
                        <Ticket size={13} /> Issue Token
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SECTION 2: Live Patient Consultation Queue */}
      {(activeTab === "overview" || activeTab === "queue") && (
        <div className="space-y-4 pt-2">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
              <Ticket size={18} className="text-emerald-600" />
              Live Consultation Queue ({tokens.length})
            </h2>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500">Date:</span>
              <span className="text-xs font-bold text-slate-800 bg-white border border-slate-200 px-2.5 py-1 rounded-lg">
                {date}
              </span>
            </div>
          </div>

          {isLoading ? (
            <div className="animate-pulse space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 bg-slate-200/60 rounded-2xl" />
              ))}
            </div>
          ) : tokens.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200/80 p-12 text-center shadow-2xs">
              <div className="w-16 h-16 rounded-3xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-4 border border-emerald-100 shadow-sm">
                <Ticket size={32} />
              </div>
              <h3 className="text-base font-extrabold text-slate-800">
                No Consultation Tokens Issued For {date}
              </h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto mt-1 mb-6">
                The front desk queue is currently clear. Select a doctor above or click below to generate the first consultation token for today.
              </p>
              <button
                onClick={() => openNewTokenForDoctor()}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl shadow-md transition-all hover:scale-105"
              >
                <Plus size={16} /> Issue First Token Now
              </button>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 text-slate-500 font-bold text-[11px] uppercase tracking-wider border-b border-slate-200/80">
                    <tr>
                      <th className="px-5 py-3.5">Token #</th>
                      <th className="px-5 py-3.5">Patient Details</th>
                      <th className="px-5 py-3.5">Doctor & OPD Room</th>
                      <th className="px-5 py-3.5">Time Slot</th>
                      <th className="px-5 py-3.5">Consultation Duration</th>
                      <th className="px-5 py-3.5">Status</th>
                      <th className="px-5 py-3.5 text-right">Desk Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {tokens.map((t) => {
                      const docIdx = doctors.findIndex(
                        (d) => d.id === t.doctor?.id || d.email === t.doctor?.email,
                      );
                      const sched = getDoctorSchedule(t.doctor, docIdx >= 0 ? docIdx : 0);

                      return (
                        <tr
                          key={t.id}
                          className="hover:bg-slate-50/80 transition-colors group"
                        >
                          <td className="px-5 py-4">
                            <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-slate-900 text-emerald-400 font-black text-xs shadow-2xs">
                              #{t.tokenNo}
                            </span>
                          </td>
                          <td className="px-5 py-4">
                            <div className="font-bold text-slate-900">
                              {t.patient?.name ?? "--"}
                            </div>
                            <div className="text-xs text-slate-500 font-mono mt-0.5">
                              {t.patient?.phone ?? ""}
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <div className="font-bold text-slate-800">
                              {doctorName(t.doctor)}
                            </div>
                            <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                              <MapPin size={11} className="text-slate-400" />
                              <span>{sched.opdRoom}</span>
                            </div>
                          </td>
                          <td className="px-5 py-4 text-xs font-mono text-slate-600">
                            {t.timeSlot ?? "--"}
                          </td>
                          <td className="px-5 py-4 text-xs font-mono tabular-nums text-slate-600">
                            {t.completedAt && t.calledAt ? (
                              <>
                                <div>
                                  {formatClockTime(t.calledAt)} – {formatClockTime(t.completedAt)}
                                </div>
                                <span className="text-[10px] text-emerald-600 font-bold block">
                                  {formatDuration(durationMinutes(t.calledAt, t.completedAt))}
                                </span>
                              </>
                            ) : t.calledAt ? (
                              <span className="text-blue-600 font-bold flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-ping" />
                                Started {formatClockTime(t.calledAt)}
                              </span>
                            ) : (
                              "--"
                            )}
                          </td>
                          <td className="px-5 py-4">{statusBadge(t.status)}</td>
                          <td className="px-5 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {t.status === "pending" && (
                                <button
                                  onClick={() => callPatient(t.id)}
                                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-all shadow-2xs flex items-center gap-1"
                                >
                                  <PhoneCall size={12} /> Call In
                                </button>
                              )}
                              {t.status === "called" && (
                                <button
                                  onClick={() => completeConsultation(t.id)}
                                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-all shadow-2xs flex items-center gap-1"
                                >
                                  <CheckCircle2 size={12} /> Complete
                                </button>
                              )}
                              {(t.status === "pending" || t.status === "called") && (
                                <button
                                  onClick={() => cancelToken(t.id)}
                                  disabled={updateMutation.isPending}
                                  className="px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-xl transition-colors disabled:opacity-50"
                                >
                                  Cancel
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* New Token Modal */}
      <NewTokenModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        defaultDoctorId={preselectedDoctorId}
      />

      {/* Edit Doctor Profile Modal */}
      <EditDoctorProfileModal
        open={!!editingDoctor}
        onClose={() => setEditingDoctor(null)}
        doctor={editingDoctor}
      />
    </div>
  );
}
