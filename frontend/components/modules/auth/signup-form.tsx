"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { registerSchema, type RegisterDto, UserRole } from "@pharmerp/types";
import { apiClient } from "@/lib/api-client";
import Link from "next/link";

const roles = [
  { label: "Admin", value: UserRole.ADMIN },
  { label: "Pharmacist", value: UserRole.PHARMACIST },
  { label: "Cashier", value: UserRole.CASHIER },
  { label: "Inventory Manager", value: UserRole.INVENTORY_MANAGER },
  { label: "Distribution Staff", value: UserRole.DISTRIBUTION_STAFF },
  { label: "HR Manager", value: UserRole.HR_MANAGER },
  { label: "Reports Analyst", value: UserRole.REPORTS_ANALYST },
];

import { Mail, Lock, User, Briefcase, ArrowRight } from "lucide-react";

export function SignupForm() {
  const router = useRouter();

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
        // @ts-ignore - passing extra fields for UI display
        originalError: errorData?.originalError,
        stack: errorData?.stack,
      });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-sm font-medium flex items-center gap-2">
            <User className="w-4 h-4 text-muted-foreground" />
            First Name
          </label>
          <input
            type="text"
            {...register("firstName")}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
            placeholder="John"
          />
          {errors.firstName && (
            <p className="text-red-500 text-xs">{errors.firstName.message}</p>
          )}
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium flex items-center gap-2">
            <User className="w-4 h-4 text-muted-foreground" />
            Last Name
          </label>
          <input
            type="text"
            {...register("lastName")}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
            placeholder="Doe"
          />
          {errors.lastName && (
            <p className="text-red-500 text-xs">{errors.lastName.message}</p>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium flex items-center gap-2">
          <Mail className="w-4 h-4 text-muted-foreground" />
          Email
        </label>
        <input
          type="email"
          {...register("email")}
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
          placeholder="email@example.com"
        />
        {errors.email && (
          <p className="text-red-500 text-xs">{errors.email.message}</p>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium flex items-center gap-2">
          <Lock className="w-4 h-4 text-muted-foreground" />
          Password
        </label>
        <input
          type="password"
          {...register("password")}
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
          placeholder="••••••••"
        />
        {errors.password && (
          <p className="text-red-500 text-xs">{errors.password.message}</p>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium flex items-center gap-2">
          <Briefcase className="w-4 h-4 text-muted-foreground" />
          Role
        </label>
        <select
          {...register("role")}
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 bg-background transition-all"
        >
          <option value="">Select your professional role</option>
          {roles.map((role) => (
            <option key={role.value} value={role.value}>
              {role.label}
            </option>
          ))}
        </select>
        {errors.role && (
          <p className="text-red-500 text-xs">{errors.role.message}</p>
        )}
      </div>

      {errors.root && (
        <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-2 rounded-lg text-sm space-y-2">
          <p className="font-semibold">{errors.root.message}</p>
          {(errors.root as any).originalError && (
            <p className="text-xs opacity-80 bg-destructive/5 p-2 rounded border border-destructive/10 font-mono">
              <strong>Error:</strong> {(errors.root as any).originalError}
            </p>
          )}
          {(errors.root as any).stack && process.env.NODE_ENV === "development" && (
            <details className="text-[10px] opacity-70">
              <summary className="cursor-pointer hover:underline">View Stack Trace</summary>
              <pre className="mt-2 p-2 bg-black/5 rounded overflow-x-auto whitespace-pre-wrap">
                {(errors.root as any).stack}
              </pre>
            </details>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full bg-primary text-primary-foreground py-2.5 rounded-lg font-semibold text-sm hover:opacity-90 disabled:opacity-60 transition-all flex items-center justify-center gap-2 group"
      >
        {isSubmitting ? "Creating account..." : (
          <>
            Create Account
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </>
        )}
      </button>

      <div className="text-center pt-2">
        <p className="text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="text-primary hover:underline font-semibold">
            Sign in
          </Link>
        </p>
      </div>
    </form>
  );
}
