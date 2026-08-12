"use client";

import { useEffect, useState } from "react";
import { UserPlus, UserCog, AlertTriangle, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import {
  useBranches,
  useCreateUser,
  useUpdateUser,
  rowsOf,
  extractError,
} from "@/queries/admin.queries";
import { ROLE_OPTIONS, roleLabel } from "./role-meta";

const inputCls = (hasError = false) =>
  [
    "w-full rounded-lg border px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400",
    "focus:outline-none focus:ring-2 focus:ring-offset-0 transition-shadow",
    hasError
      ? "border-red-300 focus:ring-red-200 bg-red-50/30"
      : "border-slate-200 focus:ring-emerald-100 focus:border-emerald-400 bg-white hover:border-slate-300",
  ].join(" ");

const labelCls = "block text-xs font-medium text-slate-600 mb-1.5";

export interface EditableUser {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  role: string;
  branchId?: string | null;
  isActive: boolean;
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

interface Props {
  open: boolean;
  onClose: () => void;
  /** Omit to create. */
  user?: EditableUser | null;
}

interface FormState {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: string;
  branchId: string;
  // Doctor profile fields
  specialty: string;
  consultationFee: string;
  opdRoom: string;
  regNo: string;
  phone: string;
  availabilityStatus: string;
  slot1Days: string;
  slot1Hours: string;
  slot2Days: string;
  slot2Hours: string;
}

const EMPTY: FormState = {
  email: "",
  password: "",
  firstName: "",
  lastName: "",
  role: "cashier",
  branchId: "",
  specialty: "General Medicine & Primary Care",
  consultationFee: "400",
  opdRoom: "OPD Cabin 101 (Ground Floor)",
  regNo: "",
  phone: "",
  availabilityStatus: "available",
  slot1Days: "Mon - Fri",
  slot1Hours: "09:00 AM - 01:00 PM & 04:00 PM - 07:00 PM",
  slot2Days: "Saturday",
  slot2Hours: "09:00 AM - 02:00 PM",
};

export function UserFormModal({ open, onClose, user }: Props) {
  const isEdit = !!user;
  const { success: toastSuccess, error: toastError } = useToast();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: branchesRaw } = useBranches();
  const branches = rowsOf<any>(branchesRaw);

  const createMutation = useCreateUser();
  const updateMutation = useUpdateUser();
  const pending = createMutation.isPending || updateMutation.isPending;

  useEffect(() => {
    if (!open) return;
    setError(null);
    const dp = user?.doctorProfile;
    const sched = dp?.weeklySchedule ?? [];
    setForm(
      user
        ? {
            email: user.email,
            password: "",
            firstName: user.firstName ?? "",
            lastName: user.lastName ?? "",
            role: user.role,
            branchId: user.branchId ?? "",
            specialty: dp?.specialty ?? "General Medicine & Primary Care",
            consultationFee: dp?.consultationFee ? String(dp.consultationFee) : "400",
            opdRoom: dp?.opdRoom ?? "OPD Cabin 101 (Ground Floor)",
            regNo: dp?.regNo ?? "",
            phone: dp?.phone ?? "",
            availabilityStatus: dp?.availabilityStatus ?? "available",
            slot1Days: sched[0]?.days ?? "Mon - Fri",
            slot1Hours: sched[0]?.slots ?? "09:00 AM - 01:00 PM & 04:00 PM - 07:00 PM",
            slot2Days: sched[1]?.days ?? "Saturday",
            slot2Hours: sched[1]?.slots ?? "09:00 AM - 02:00 PM",
          }
        : EMPTY,
    );
  }, [open, user]);

  const field = (key: keyof FormState) => ({
    value: form[key],
    onChange: (
      e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
    ) => setForm((f) => ({ ...f, [key]: e.target.value })),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // A super_admin is the one role that legitimately has no branch; sending
    // "" would fail uuid validation.
    const branchId = form.branchId === "" ? null : form.branchId;

    const doctorProfile = form.role === "doctor" ? {
      specialty: form.specialty.trim() || "General Medicine & Primary Care",
      consultationFee: parseFloat(form.consultationFee) || 400,
      opdRoom: form.opdRoom.trim() || "OPD Cabin 101 (Ground Floor)",
      regNo: form.regNo.trim() || undefined,
      phone: form.phone.trim() || undefined,
      availabilityStatus: form.availabilityStatus,
      weeklySchedule: [
        { days: form.slot1Days || "Mon - Fri", slots: form.slot1Hours || "09:00 AM - 01:00 PM & 04:00 PM - 07:00 PM" },
        ...(form.slot2Days ? [{ days: form.slot2Days, slots: form.slot2Hours || "09:00 AM - 02:00 PM" }] : []),
      ],
    } : undefined;

    if (isEdit) {
      updateMutation.mutate(
        {
          id: user!.id,
          data: {
            firstName: form.firstName,
            lastName: form.lastName,
            role: form.role,
            branchId,
            doctorProfile: doctorProfile as any,
          },
        },
        {
          onSuccess: () => {
            toastSuccess("User updated", form.email);
            onClose();
          },
          onError: (err) =>
            setError(extractError(err, "Failed to update the user.")),
        },
      );
      return;
    }

    createMutation.mutate(
      {
        email: form.email,
        password: form.password,
        firstName: form.firstName,
        lastName: form.lastName,
        role: form.role,
        branchId,
        doctorProfile: doctorProfile as any,
      },
      {
        onSuccess: () => {
          toastSuccess("User created", `${form.email} can now sign in.`);
          onClose();
        },
        onError: (err) => {
          const msg = extractError(err, "Failed to create the user.");
          setError(msg);
          toastError("Could not create user", msg);
        },
      },
    );
  };

  const grantingSuperAdmin = form.role === "super_admin";
  const isDoctorRole = form.role === "doctor";

  return (
    <Modal
      title={isEdit ? "Edit user" : "Create user"}
      subtitle={
        isEdit
          ? "Change profile, role, or branch assignment"
          : "Create an account and assign any role, including doctor or admin"
      }
      icon={isEdit ? <UserCog size={16} /> : <UserPlus size={16} />}
      open={open}
      onClose={onClose}
      size={isDoctorRole ? "lg" : "md"}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>
              First name <span className="text-red-500">*</span>
            </label>
            <input required minLength={2} placeholder="Jane" className={inputCls()} {...field("firstName")} />
          </div>
          <div>
            <label className={labelCls}>
              Last name <span className="text-red-500">*</span>
            </label>
            <input required minLength={2} placeholder="Doe" className={inputCls()} {...field("lastName")} />
          </div>
        </div>

        <div>
          <label className={labelCls}>
            Email <span className="text-red-500">*</span>
          </label>
          <input
            required
            type="email"
            placeholder="jane@pharmacy.com"
            className={inputCls()}
            disabled={isEdit}
            {...field("email")}
          />
          {isEdit && (
            <p className="text-xs text-slate-400 mt-1">
              Email is the sign-in identifier and cannot be changed here.
            </p>
          )}
        </div>

        {!isEdit && (
          <div>
            <label className={labelCls}>
              Initial password <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                required
                type={showPassword ? "text" : "password"}
                minLength={8}
                placeholder="Min 8 chars, one uppercase, one number"
                className={`${inputCls()} pr-10`}
                {...field("password")}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>
              Role <span className="text-red-500">*</span>
            </label>
            <select required className={inputCls()} {...field("role")}>
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Branch</label>
            <select className={inputCls()} {...field("branchId")}>
              <option value="">
                {grantingSuperAdmin ? "All branches" : "No branch"}
              </option>
              {branches.map((b: any) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Doctor-Specific OPD Profile & Timings Section */}
        {isDoctorRole && (
          <div className="border border-emerald-200 bg-emerald-50/40 rounded-xl p-4 space-y-3.5">
            <div className="flex items-center justify-between border-b border-emerald-200/60 pb-2">
              <h4 className="text-xs font-black uppercase tracking-wider text-emerald-800 flex items-center gap-1.5">
                👨‍⚕️ Doctor OPD Profile & Duty Timings
              </h4>
              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-md border border-emerald-200">
                 OPD Configuration
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Medical Specialization / Department</label>
                <select className={inputCls()} {...field("specialty")}>
                  <option value="General Medicine & Primary Care">General Medicine & Primary Care</option>
                  <option value="Cardiology & Heart Care">Cardiology & Heart Care</option>
                  <option value="Pediatrics & Child Health">Pediatrics & Child Health</option>
                  <option value="Orthopedics & Joint Care">Orthopedics & Joint Care</option>
                  <option value="Dermatology & Skin Care">Dermatology & Skin Care</option>
                  <option value="Gynecology & Women's Health">Gynecology & Women's Health</option>
                  <option value="ENT & Head/Neck">ENT & Head/Neck</option>
                  <option value="Neurology & Brain Health">Neurology & Brain Health</option>
                  <option value="Psychiatry & Behavioral Health">Psychiatry & Behavioral Health</option>
                  <option value="Dentistry & Dental Care">Dentistry & Dental Care</option>
                </select>
              </div>

              <div>
                <label className={labelCls}>Consultation Fee (₹)</label>
                <input
                  type="number"
                  placeholder="400"
                  min="0"
                  className={inputCls()}
                  {...field("consultationFee")}
                />
              </div>

              <div>
                <label className={labelCls}>OPD Room / Cabin Location</label>
                <input
                  type="text"
                  placeholder="e.g. OPD Cabin 101 (Ground Floor)"
                  className={inputCls()}
                  {...field("opdRoom")}
                />
              </div>

              <div>
                <label className={labelCls}>Medical Reg / License No.</label>
                <input
                  type="text"
                  placeholder="e.g. MCI-2024-99120"
                  className={inputCls()}
                  {...field("regNo")}
                />
              </div>

              <div>
                <label className={labelCls}>Doctor Direct Phone</label>
                <input
                  type="tel"
                  placeholder="e.g. +91 9876543210"
                  className={inputCls()}
                  {...field("phone")}
                />
              </div>

              <div>
                <label className={labelCls}>Availability Status</label>
                <select className={inputCls()} {...field("availabilityStatus")}>
                  <option value="available">Available Today</option>
                  <option value="on_call">On Call / Emergency</option>
                  <option value="on_leave">On Leave</option>
                  <option value="busy">Busy / In Surgery</option>
                </select>
              </div>
            </div>

            <div className="space-y-2 pt-1 border-t border-emerald-200/60">
              <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                Weekly OPD Timings & Schedule
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-[10px] text-slate-500 font-semibold">Slot 1 Days</span>
                  <input type="text" placeholder="Mon - Fri" className={inputCls()} {...field("slot1Days")} />
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 font-semibold">Slot 1 Hours</span>
                  <input type="text" placeholder="09:00 AM - 01:00 PM & 04:00 PM - 07:00 PM" className={inputCls()} {...field("slot1Hours")} />
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 font-semibold">Slot 2 Days (Optional)</span>
                  <input type="text" placeholder="Saturday" className={inputCls()} {...field("slot2Days")} />
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 font-semibold">Slot 2 Hours (Optional)</span>
                  <input type="text" placeholder="09:00 AM - 02:00 PM" className={inputCls()} {...field("slot2Hours")} />
                </div>
              </div>
            </div>
          </div>
        )}

        {grantingSuperAdmin && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
            <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800">
              <strong>Super admin grants unrestricted access</strong> to every
              branch and every module, including this console and the ability to
              create further super admins. It bypasses all role checks.
            </p>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 text-red-600 text-sm">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
          >
            {pending ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <CheckCircle2 size={14} />
                {isEdit ? "Save changes" : "Create user"}
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
