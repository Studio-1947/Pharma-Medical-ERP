"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  UserPlus,
  Search,
  ShieldCheck,
  ShieldOff,
  UserCheck,
  UserX,
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
} from "lucide-react";
import { apiClient, queryKeys } from "@/lib/api-client";
import { Modal } from "@/components/ui/modal";
import { usePermissions } from "@/hooks/use-permissions";
import { UserRole } from "@pharmerp/types";

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

interface ApiListResponse {
  data: User[];
  meta: { total: number; page: number; totalPages: number; limit: number };
}

// super_admin cannot be created via UI — seed script only
const ROLE_OPTIONS = [
  "ADMIN",
  "DOCTOR",
  "PHARMACIST",
  "CASHIER",
  "INVENTORY_MANAGER",
  "DISTRIBUTION_STAFF",
  "HR_MANAGER",
  "REPORTS_ANALYST",
];

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: "bg-teal-100 text-teal-700",
  ADMIN: "bg-emerald-100 text-emerald-700",
  DOCTOR: "bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold",
  PHARMACIST: "bg-green-100 text-green-700",
  CASHIER: "bg-amber-100 text-amber-700",
  INVENTORY_MANAGER: "bg-teal-100 text-teal-700",
  DISTRIBUTION_STAFF: "bg-orange-100 text-orange-700",
  HR_MANAGER: "bg-pink-100 text-pink-700",
  REPORTS_ANALYST: "bg-slate-100 text-slate-700",
};

const inputCls = (hasError = false) =>
  [
    "w-full rounded-lg border px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400",
    "focus:outline-none focus:ring-2 focus:ring-offset-0 transition-shadow",
    hasError
      ? "border-red-300 focus:ring-red-200 bg-red-50/30"
      : "border-slate-200 focus:ring-emerald-100 focus:border-emerald-400 bg-white hover:border-slate-300",
  ].join(" ");

interface InviteForm {
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  password: string;
  branchId?: string;
  specialty?: string;
  consultationFee?: string;
  opdRoom?: string;
  regNo?: string;
  phone?: string;
  slot1Days?: string;
  slot1Hours?: string;
  slot2Days?: string;
  slot2Hours?: string;
}

function InviteUserModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { role } = usePermissions();
  const [form, setForm] = useState<InviteForm>({
    email: "",
    firstName: "",
    lastName: "",
    role: "CASHIER",
    password: "",
    branchId: "",
    specialty: "General Medicine & Primary Care",
    consultationFee: "400",
    opdRoom: "OPD Cabin 101 (Ground Floor)",
    regNo: "",
    phone: "",
    slot1Days: "Mon - Fri",
    slot1Hours: "09:00 AM - 01:00 PM & 04:00 PM - 07:00 PM",
    slot2Days: "Saturday",
    slot2Hours: "09:00 AM - 02:00 PM",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: branchesRaw } = useQuery<any>({
    queryKey: ["branches"],
    queryFn: () => apiClient.get("/branches"),
    enabled: role === UserRole.SUPER_ADMIN && open,
  });
  const branches: any[] = Array.isArray(branchesRaw)
    ? branchesRaw
    : Array.isArray(branchesRaw?.data)
      ? branchesRaw.data
      : [];

  const isDoctorRole = form.role.toUpperCase() === "DOCTOR";

  const mutation = useMutation({
    mutationFn: (data: InviteForm) => {
      const submitData: any = {
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        role: data.role,
        password: data.password,
        branchId: data.branchId || undefined,
      };

      if (data.role.toUpperCase() === "DOCTOR") {
        submitData.doctorProfile = {
          specialty: data.specialty || "General Medicine & Primary Care",
          consultationFee: parseFloat(data.consultationFee || "400") || 400,
          opdRoom: data.opdRoom || "OPD Cabin 101 (Ground Floor)",
          regNo: data.regNo || undefined,
          phone: data.phone || undefined,
          availabilityStatus: "available",
          weeklySchedule: [
            {
              days: data.slot1Days || "Mon - Fri",
              slots: data.slot1Hours || "09:00 AM - 01:00 PM & 04:00 PM - 07:00 PM",
            },
            ...(data.slot2Days
              ? [{ days: data.slot2Days, slots: data.slot2Hours || "09:00 AM - 02:00 PM" }]
              : []),
          ],
        };
      }

      return apiClient.post("/auth/register", submitData);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.users.all() });
      qc.invalidateQueries({ queryKey: queryKeys.clinicTokens.doctors() });
      onClose();
    },
    onError: (err: any) =>
      setError(err?.response?.data?.message ?? "Failed to invite user."),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    mutation.mutate(form);
  };

  const field = (key: keyof InviteForm) => ({
    value: form[key] ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value })),
  });

  const DAY_PRESETS = [
    "Mon - Fri",
    "Mon - Sat",
    "Mon, Wed, Fri",
    "Tue, Thu, Sat",
    "Saturday",
    "Sunday",
    "Weekend (Sat, Sun)",
    "Mon - Sun (Everyday)",
  ];

  const TIME_PRESETS = [
    "09:00 AM - 01:00 PM & 04:00 PM - 07:00 PM",
    "09:00 AM - 01:00 PM",
    "10:00 AM - 02:00 PM & 05:00 PM - 08:00 PM",
    "09:00 AM - 02:00 PM",
    "04:00 PM - 08:00 PM",
    "10:00 AM - 04:00 PM",
    "On Call Emergency Only",
  ];

  return (
    <Modal
      title="Invite User / Create Account"
      subtitle="Create a new user account and configure profile role settings"
      icon={<UserPlus size={16} />}
      open={open}
      onClose={onClose}
      size={isDoctorRole ? "lg" : "md"}
    >
      <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">
              First Name <span className="text-red-500">*</span>
            </label>
            <input required placeholder="Jane" className={inputCls()} {...field("firstName")} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">
              Last Name <span className="text-red-500">*</span>
            </label>
            <input required placeholder="Doe" className={inputCls()} {...field("lastName")} />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">
            Email <span className="text-red-500">*</span>
          </label>
          <input
            required
            type="email"
            placeholder="jane@pharmacy.com"
            className={inputCls()}
            {...field("email")}
          />
        </div>
        <div className={role === UserRole.SUPER_ADMIN ? "grid grid-cols-2 gap-3" : "block"}>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">
              Role <span className="text-red-500">*</span>
            </label>
            <select required className={inputCls()} {...field("role")}>
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          {role === UserRole.SUPER_ADMIN && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">
                Branch <span className="text-red-500">*</span>
              </label>
              <select required className={inputCls()} {...field("branchId")}>
                <option value="">Select branch</option>
                {branches?.map((b: any) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">
            Temporary Password <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <input
              required
              type={showPassword ? "text" : "password"}
              placeholder="Min 8 characters"
              minLength={8}
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

        {/* Doctor OPD Profile Configuration Section */}
        {isDoctorRole && (
          <div className="space-y-3 pt-3 border-t border-slate-200 bg-emerald-50/40 -mx-6 px-6 py-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-emerald-900 uppercase tracking-wider block">
                Doctor OPD Clinical Profile & Schedule Setup
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300">
                Doctor Role Fields
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Specialization</label>
                <select className={inputCls()} {...field("specialty")}>
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
                <label className="block text-xs font-medium text-slate-600 mb-1">Consultation Fee (₹)</label>
                <input type="number" min="0" className={inputCls()} {...field("consultationFee")} />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">OPD Cabin Location</label>
                <input placeholder="e.g. OPD Cabin 101" className={inputCls()} {...field("opdRoom")} />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Medical Reg No.</label>
                <input placeholder="e.g. MCI-2024-88910" className={inputCls()} {...field("regNo")} />
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-emerald-200/60">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                Weekly OPD Timings Schedule
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-[10px] text-slate-500 font-semibold block mb-0.5">Primary Days</span>
                  <select className={inputCls()} {...field("slot1Days")}>
                    {DAY_PRESETS.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 font-semibold block mb-0.5">Primary Hours</span>
                  <select className={inputCls()} {...field("slot1Hours")}>
                    {TIME_PRESETS.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 font-semibold block mb-0.5">Secondary Days (Optional)</span>
                  <select className={inputCls()} {...field("slot2Days")}>
                    <option value="">None / Off</option>
                    {DAY_PRESETS.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 font-semibold block mb-0.5">Secondary Hours</span>
                  <select className={inputCls()} {...field("slot2Hours")}>
                    {TIME_PRESETS.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-red-600 text-sm">
            <AlertCircle size={14} />
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
            disabled={mutation.isPending}
            className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
          >
            {mutation.isPending ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Inviting...
              </>
            ) : (
              <>
                <CheckCircle2 size={14} />
                Invite User
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function UsersSettings() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [roleEdit, setRoleEdit] = useState<{ id: string; role: string } | null>(null);

  const params = { search, page, limit: 20 };

  const { data: rawData, isLoading } = useQuery<any>({
    queryKey: [...queryKeys.users.all(), params],
    queryFn: () => apiClient.get("/users", { params }),
  });

  // Normalise response regardless of whether the interceptor unwraps one or two levels
  const users: User[] = Array.isArray(rawData)
    ? rawData
    : Array.isArray(rawData?.data)
      ? rawData.data
      : [];
  const meta = rawData?.meta ?? rawData?.data?.meta ?? null;
  const data = users.length > 0 || meta ? { data: users, meta } : null;

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/users/${id}/deactivate`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.users.all() }),
  });

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/users/${id}/reactivate`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.users.all() }),
  });

  const changeRoleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) =>
      apiClient.patch(`/users/${id}/role`, { role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.users.all() });
      setRoleEdit(null);
    },
  });

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search users..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <button
          onClick={() => setInviteOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90"
        >
          <UserPlus size={16} />
          Invite User
        </button>
      </div>

      {isLoading && (
        <div className="space-y-2 py-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 rounded-lg bg-slate-100 animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && (
        <>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">User</th>
                  <th className="text-left px-4 py-3 font-medium">Role</th>
                  <th className="text-center px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Joined</th>
                  <th className="text-center px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-muted/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium">
                        {u.firstName} {u.lastName}
                      </div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      {roleEdit?.id === u.id ? (
                        <div className="flex items-center gap-1">
                          <select
                            value={roleEdit.role}
                            onChange={(e) => setRoleEdit({ id: u.id, role: e.target.value })}
                            className="border rounded text-xs px-2 py-1"
                          >
                            {ROLE_OPTIONS.map((r) => (
                              <option key={r} value={r}>
                                {r.replace(/_/g, " ")}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => changeRoleMutation.mutate({ id: u.id, role: roleEdit.role })}
                            className="text-xs text-green-600 hover:underline"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setRoleEdit(null)}
                            className="text-xs text-slate-500 hover:underline"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-xs font-medium cursor-pointer ${
                            ROLE_COLORS[u.role] ?? "bg-slate-100 text-slate-600"
                          }`}
                          onClick={() => setRoleEdit({ id: u.id, role: u.role })}
                          title="Click to change role"
                        >
                          {u.role.replace(/_/g, " ")}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                          u.isActive
                            ? "bg-green-100 text-green-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {u.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(u.createdAt).toLocaleDateString("en-IN")}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        {u.isActive ? (
                          <button
                            onClick={() => deactivateMutation.mutate(u.id)}
                            disabled={deactivateMutation.isPending}
                            className="flex items-center gap-1 text-xs text-red-500 hover:underline disabled:opacity-50"
                          >
                            <UserX size={12} />
                            Deactivate
                          </button>
                        ) : (
                          <button
                            onClick={() => reactivateMutation.mutate(u.id)}
                            disabled={reactivateMutation.isPending}
                            className="flex items-center gap-1 text-xs text-green-600 hover:underline disabled:opacity-50"
                          >
                            <UserCheck size={12} />
                            Reactivate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center py-16 text-muted-foreground">
                      No users found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
            <span>
              {meta?.total ?? users.length} total &bull; page {meta?.page ?? page} of {meta?.totalPages ?? 1}
            </span>
            <div className="flex gap-2">
              <button
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1 border rounded-lg disabled:opacity-40 hover:bg-muted"
              >
                Prev
              </button>
              <button
                disabled={page >= (meta?.totalPages ?? 1)}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1 border rounded-lg disabled:opacity-40 hover:bg-muted"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      <InviteUserModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  );
}
