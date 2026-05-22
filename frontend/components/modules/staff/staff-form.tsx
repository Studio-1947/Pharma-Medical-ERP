"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { registerSchema, type RegisterDto, UserRole } from "@pharmerp/types";
import { apiClient } from "@/lib/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { Mail, Lock, User, Briefcase, AlertCircle, Loader2 } from "lucide-react";

const roles = [
  { label: "Admin", value: UserRole.ADMIN },
  { label: "Pharmacist", value: UserRole.PHARMACIST },
  { label: "Cashier", value: UserRole.CASHIER },
  { label: "Inventory Manager", value: UserRole.INVENTORY_MANAGER },
  { label: "Distribution Staff", value: UserRole.DISTRIBUTION_STAFF },
  { label: "HR Manager", value: UserRole.HR_MANAGER },
  { label: "Reports Analyst", value: UserRole.REPORTS_ANALYST },
];

interface StaffFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export function StaffForm({ onSuccess, onCancel }: StaffFormProps) {
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<RegisterDto>({
    resolver: zodResolver(registerSchema),
  });

  const onSubmit = async (data: RegisterDto) => {
    try {
      await apiClient.post("/auth/register", data);
      queryClient.invalidateQueries({ queryKey: ["users"] });
      onSuccess();
    } catch (err: any) {
      const errorData = err?.response?.data;
      setError("root", {
        message: errorData?.message ?? "Failed to create staff member.",
        // @ts-ignore
        originalError: errorData?.originalError,
      });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {/* Name row */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
            First Name
          </label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              {...register("firstName")}
              className={`w-full border rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition-all ${
                errors.firstName ? "border-red-300 bg-red-50" : "border-slate-200 bg-white"
              }`}
              placeholder="John"
            />
          </div>
          {errors.firstName && (
            <p className="text-red-500 text-xs flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />{errors.firstName.message}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
            Last Name
          </label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              {...register("lastName")}
              className={`w-full border rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition-all ${
                errors.lastName ? "border-red-300 bg-red-50" : "border-slate-200 bg-white"
              }`}
              placeholder="Doe"
            />
          </div>
          {errors.lastName && (
            <p className="text-red-500 text-xs flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />{errors.lastName.message}
            </p>
          )}
        </div>
      </div>

      {/* Email */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
          Email Address
        </label>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            type="email"
            {...register("email")}
            className={`w-full border rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition-all ${
              errors.email ? "border-red-300 bg-red-50" : "border-slate-200 bg-white"
            }`}
            placeholder="john.doe@pharmacy.com"
          />
        </div>
        {errors.email && (
          <p className="text-red-500 text-xs flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />{errors.email.message}
          </p>
        )}
      </div>

      {/* Password + Role row */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
            Initial Password
          </label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              type="password"
              {...register("password")}
              className={`w-full border rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition-all ${
                errors.password ? "border-red-300 bg-red-50" : "border-slate-200 bg-white"
              }`}
              placeholder="Min. 8 characters"
            />
          </div>
          {errors.password && (
            <p className="text-red-500 text-xs flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />{errors.password.message}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
            Role
          </label>
          <div className="relative">
            <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            <select
              {...register("role")}
              className={`w-full border rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 bg-white transition-all appearance-none ${
                errors.role ? "border-red-300 bg-red-50" : "border-slate-200"
              }`}
            >
              <option value="">Select role...</option>
              {roles.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
          </div>
          {errors.role && (
            <p className="text-red-500 text-xs flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />{errors.role.message}
            </p>
          )}
        </div>
      </div>

      {/* Root error */}
      {errors.root && (
        <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 text-red-700 px-3 py-2.5 rounded-lg text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">{errors.root.message}</p>
            {(errors.root as any).originalError && (
              <p className="text-xs opacity-70 font-mono mt-0.5">
                {(errors.root as any).originalError}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2.5 pt-2 border-t border-slate-100 mt-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 text-white py-2 rounded-lg font-semibold text-sm hover:bg-emerald-700 disabled:opacity-60 transition-colors shadow-sm"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Creating...
            </>
          ) : (
            "Create Staff Member"
          )}
        </button>
      </div>
    </form>
  );
}
