"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { registerSchema, type RegisterDto, UserRole } from "@pharmerp/types";
import { apiClient } from "@/lib/api-client";
import { usePermissions } from "@/hooks/use-permissions";
import { useAuthStore } from "@/stores/auth.store";
import { UserPlus, Users, ShieldAlert } from "lucide-react";

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: UserRole.ADMIN, label: "Admin" },
  { value: UserRole.PHARMACIST, label: "Pharmacist" },
  { value: UserRole.CASHIER, label: "Cashier" },
  { value: UserRole.INVENTORY_MANAGER, label: "Inventory Manager" },
  { value: UserRole.DISTRIBUTION_STAFF, label: "Distribution Staff" },
  { value: UserRole.HR_MANAGER, label: "HR Manager" },
  { value: UserRole.REPORTS_ANALYST, label: "Reports Analyst" },
];

export default function UsersPage() {
  const { can, role } = usePermissions();
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [success, setSuccess] = useState<string | null>(null);

  if (!can("users.manage")) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-gray-500">
        <ShieldAlert size={32} className="text-red-400" />
        <p className="font-medium">You do not have permission to manage users.</p>
      </div>
    );
  }

  // admin role can only create branch-level roles, not another admin
  const availableRoles = role === UserRole.SUPER_ADMIN
    ? ROLE_OPTIONS
    : ROLE_OPTIONS.filter((r) => r.value !== UserRole.ADMIN);

  const { data: branches } = useQuery({
    queryKey: ["branches"],
    queryFn: () => apiClient.get("/branches") as Promise<any>,
    enabled: role === UserRole.SUPER_ADMIN,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<RegisterDto>({
    resolver: zodResolver(registerSchema),
    defaultValues: { branchId: user?.branchId ?? undefined },
  });

  const { mutate, isPending, error: mutError } = useMutation({
    mutationFn: (dto: RegisterDto) => apiClient.post("/auth/register", dto),
    onSuccess: (_, vars) => {
      setSuccess(`Account created for ${vars.email}`);
      reset({ branchId: user?.branchId ?? undefined });
      qc.invalidateQueries({ queryKey: ["users"] });
      setTimeout(() => setSuccess(null), 4000);
    },
  });

  const errMsg = (mutError as any)?.response?.data?.message ?? (mutError as any)?.message;

  return (
    <div className="max-w-xl space-y-8">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
          <Users size={20} className="text-emerald-700 dark:text-emerald-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-foreground">Manage Users</h1>
          <p className="text-sm text-gray-500 dark:text-muted-foreground">
            Create staff accounts for your pharmacy team
          </p>
        </div>
      </div>

      <form
        onSubmit={handleSubmit((data) => {
          const submitData = {
            ...data,
            branchId: data.branchId || undefined,
          };
          mutate(submitData);
        })}
        className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-2xl p-6 space-y-5 shadow-sm"
      >
        <div className="flex items-center gap-2 mb-1">
          <UserPlus size={16} className="text-emerald-600" />
          <span className="font-semibold text-gray-800 dark:text-foreground text-sm">New Staff Account</span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600 dark:text-muted-foreground">First Name</label>
            <input
              {...register("firstName")}
              className="w-full border border-gray-200 dark:border-border rounded-lg px-3 py-2 text-sm bg-white dark:bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              placeholder="First name"
            />
            {errors.firstName && <p className="text-red-500 text-xs">{errors.firstName.message}</p>}
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600 dark:text-muted-foreground">Last Name</label>
            <input
              {...register("lastName")}
              className="w-full border border-gray-200 dark:border-border rounded-lg px-3 py-2 text-sm bg-white dark:bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              placeholder="Last name"
            />
            {errors.lastName && <p className="text-red-500 text-xs">{errors.lastName.message}</p>}
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600 dark:text-muted-foreground">Email</label>
          <input
            {...register("email")}
            type="email"
            className="w-full border border-gray-200 dark:border-border rounded-lg px-3 py-2 text-sm bg-white dark:bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            placeholder="staff@example.com"
          />
          {errors.email && <p className="text-red-500 text-xs">{errors.email.message}</p>}
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600 dark:text-muted-foreground">Temporary Password</label>
          <input
            {...register("password")}
            type="password"
            className="w-full border border-gray-200 dark:border-border rounded-lg px-3 py-2 text-sm bg-white dark:bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            placeholder="Min 8 characters"
          />
          {errors.password && <p className="text-red-500 text-xs">{errors.password.message}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600 dark:text-muted-foreground">Role</label>
            <select
              {...register("role")}
              className="w-full border border-gray-200 dark:border-border rounded-lg px-3 py-2 text-sm bg-white dark:bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            >
              <option value="">Select role</option>
              {availableRoles.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            {errors.role && <p className="text-red-500 text-xs">{errors.role.message}</p>}
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600 dark:text-muted-foreground">Branch</label>
            {role === UserRole.SUPER_ADMIN ? (
              <select
                {...register("branchId")}
                className="w-full border border-gray-200 dark:border-border rounded-lg px-3 py-2 text-sm bg-white dark:bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              >
                <option value="">Select branch</option>
                {(branches as any[])?.map((b: any) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            ) : (
              <input
                value={user?.branchId ?? ""}
                disabled
                className="w-full border border-gray-100 dark:border-border rounded-lg px-3 py-2 text-sm bg-gray-50 dark:bg-muted text-gray-400 cursor-not-allowed"
                placeholder="Your branch (auto-assigned)"
              />
            )}
          </div>
        </div>

        {errMsg && (
          <p className="text-red-600 text-sm bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
            {errMsg}
          </p>
        )}

        {success && (
          <p className="text-emerald-700 text-sm bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-2">
            {success}
          </p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="w-full bg-emerald-700 hover:bg-emerald-800 text-white py-2.5 rounded-xl font-semibold text-sm disabled:opacity-60 transition-colors"
        >
          {isPending ? "Creating account..." : "Create Account"}
        </button>
      </form>

      <p className="text-xs text-gray-400 dark:text-muted-foreground">
        The new staff member will log in using the email and temporary password above. Ask them to change it after first login.
      </p>
    </div>
  );
}
