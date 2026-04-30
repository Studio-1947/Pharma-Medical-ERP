"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { registerSchema, type RegisterDto, UserRole } from "@pharmerp/types";
import { apiClient } from "@/lib/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { Mail, Lock, User, Briefcase, X } from "lucide-react";

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
          Initial Password
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
          Assign Role
        </label>
        <select
          {...register("role")}
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 bg-background transition-all"
        >
          <option value="">Select role</option>
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
        <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-2 rounded-lg text-sm space-y-1">
           <p className="font-semibold">{errors.root.message}</p>
          {(errors.root as any).originalError && (
            <p className="text-[10px] opacity-80 font-mono">
              {(errors.root as any).originalError}
            </p>
          )}
        </div>
      )}

      <div className="flex gap-3 pt-4">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 px-4 py-2 border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex-1 bg-primary text-primary-foreground py-2 rounded-lg font-semibold text-sm hover:opacity-90 disabled:opacity-60 transition-all"
        >
          {isSubmitting ? "Creating..." : "Create Staff"}
        </button>
      </div>
    </form>
  );
}
