"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { registerSchema, type RegisterDto, UserRole } from "@pharmerp/types";
import { apiClient } from "@/lib/api-client";
import Link from "next/link";
import { Eye, EyeOff, Mail, Lock, User, Briefcase, AlertCircle } from "lucide-react";

const roles = [
  { label: "Admin", value: UserRole.ADMIN },
  { label: "Pharmacist", value: UserRole.PHARMACIST },
  { label: "Cashier", value: UserRole.CASHIER },
  { label: "Inventory Manager", value: UserRole.INVENTORY_MANAGER },
  { label: "Distribution Staff", value: UserRole.DISTRIBUTION_STAFF },
  { label: "HR Manager", value: UserRole.HR_MANAGER },
  { label: "Reports Analyst", value: UserRole.REPORTS_ANALYST },
];

const inputClass =
  "w-full border border-gray-200 dark:border-border bg-white dark:bg-background rounded-xl py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500 transition-all placeholder:text-gray-400";

export function SignupForm() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);

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
      router.push("/login?registered=true");
    } catch (err: any) {
      const errorData = err?.response?.data;
      setError("root", {
        message: errorData?.message ?? "Registration failed. Please try again.",
        // @ts-ignore
        originalError: errorData?.originalError,
        stack: errorData?.stack,
      });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {/* Name row */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700 dark:text-foreground">
            First name
          </label>
          <div className="relative">
            <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              {...register("firstName")}
              className={`${inputClass} pl-8 pr-3`}
              placeholder="John"
              autoComplete="given-name"
            />
          </div>
          {errors.firstName && (
            <p className="text-red-500 text-xs">{errors.firstName.message}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700 dark:text-foreground">
            Last name
          </label>
          <div className="relative">
            <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              {...register("lastName")}
              className={`${inputClass} pl-8 pr-3`}
              placeholder="Doe"
              autoComplete="family-name"
            />
          </div>
          {errors.lastName && (
            <p className="text-red-500 text-xs">{errors.lastName.message}</p>
          )}
        </div>
      </div>

      {/* Email */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-gray-700 dark:text-foreground">
          Email address
        </label>
        <div className="relative">
          <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="email"
            {...register("email")}
            className={`${inputClass} pl-9 pr-4`}
            placeholder="you@example.com"
            autoComplete="email"
          />
        </div>
        {errors.email && (
          <p className="text-red-500 text-xs">{errors.email.message}</p>
        )}
      </div>

      {/* Password */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-gray-700 dark:text-foreground">
          Password
        </label>
        <div className="relative">
          <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type={showPassword ? "text" : "password"}
            {...register("password")}
            className={`${inputClass} pl-9 pr-10`}
            placeholder="Min 8 chars, uppercase & number"
            autoComplete="new-password"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
            tabIndex={-1}
          >
            {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
        {errors.password && (
          <p className="text-red-500 text-xs">{errors.password.message}</p>
        )}
      </div>

      {/* Role */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-gray-700 dark:text-foreground">
          Role
        </label>
        <div className="relative">
          <Briefcase size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <select
            {...register("role")}
            className={`${inputClass} pl-9 pr-4 bg-white dark:bg-background appearance-none`}
          >
            <option value="">Select your professional role</option>
            {roles.map((role) => (
              <option key={role.value} value={role.value}>
                {role.label}
              </option>
            ))}
          </select>
        </div>
        {errors.role && (
          <p className="text-red-500 text-xs">{errors.role.message}</p>
        )}
      </div>

      {errors.root && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="font-medium">{errors.root.message}</p>
            {(errors.root as any).originalError && (
              <p className="text-xs opacity-80 font-mono">
                {(errors.root as any).originalError}
              </p>
            )}
          </div>
        </div>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full bg-violet-700 hover:bg-violet-800 text-white py-2.5 rounded-xl font-semibold text-sm disabled:opacity-60 transition-colors mt-2"
      >
        {isSubmitting ? "Creating account..." : "Create account"}
      </button>

      <p className="text-center text-sm text-gray-500 dark:text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="text-violet-700 dark:text-violet-400 hover:underline font-semibold">
          Sign in
        </Link>
      </p>
    </form>
  );
}
