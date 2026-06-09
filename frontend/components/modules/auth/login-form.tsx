"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { loginSchema, type LoginDto } from "@pharmerp/types";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth.store";
import { Eye, EyeOff, Mail, Lock, AlertCircle } from "lucide-react";

export function LoginForm() {
  const router = useRouter();
  const { setTokens, setUser } = useAuthStore();
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<LoginDto>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginDto) => {
    try {
      const res: any = await apiClient.post("/auth/login", data);
      setTokens(res.accessToken, res.refreshToken);
      try {
        const payload = JSON.parse(atob(res.accessToken.split(".")[1]!));
        setUser({ id: payload.sub, email: payload.email, role: payload.role, branchId: payload.branchId });
      } catch {
        // Token decode failed — user info will load on next request
      }
      router.push("/dashboard");
    } catch (err: any) {
      const errorData = err?.response?.data;
      setError("root", {
        message: errorData?.message ?? "Login failed. Check credentials.",
        // @ts-ignore
        originalError: errorData?.originalError,
        stack: errorData?.stack,
      });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-gray-700 dark:text-foreground">
          Email address
        </label>
        <div className="relative">
          <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="email"
            {...register("email")}
            className="w-full border border-gray-200 dark:border-border bg-white dark:bg-background rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition-all placeholder:text-gray-400"
            placeholder="you@example.com"
            autoComplete="email"
          />
        </div>
        {errors.email && (
          <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-gray-700 dark:text-foreground">
          Password
        </label>
        <div className="relative">
          <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type={showPassword ? "text" : "password"}
            {...register("password")}
            className="w-full border border-gray-200 dark:border-border bg-white dark:bg-background rounded-xl pl-9 pr-10 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition-all placeholder:text-gray-400"
            placeholder="Enter your password"
            autoComplete="current-password"
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
          <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>
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
        className="w-full bg-emerald-700 hover:bg-emerald-800 text-white py-2.5 rounded-xl font-semibold text-sm disabled:opacity-60 transition-colors mt-2"
      >
        {isSubmitting ? "Signing in..." : "Sign in"}
      </button>

      <p className="text-center text-sm text-gray-500 dark:text-muted-foreground">
        Contact your administrator to get access.
      </p>
    </form>
  );
}
