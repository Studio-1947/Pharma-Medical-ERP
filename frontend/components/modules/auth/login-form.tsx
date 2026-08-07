"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { loginSchema, type LoginDto } from "@pharmerp/types";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth.store";
import { landingPathForRole } from "@/lib/nav-items";
import { Eye, EyeOff, Mail, Lock, AlertCircle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

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
      let role: string | undefined;
      try {
        const payload = JSON.parse(atob(res.accessToken.split(".")[1]!));
        role = payload.role;
        setUser({ id: payload.sub, email: payload.email, role: payload.role, branchId: payload.branchId });
      } catch {
        // Token decode failed — user info will load on next request
      }
      router.push(landingPathForRole(role));
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
        <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
          Email address
        </label>
        <div className="relative">
          <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="email"
            {...register("email")}
            className="w-full border border-slate-200 bg-white rounded-xl pl-10 pr-4 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition-all placeholder:text-slate-400 shadow-2xs"
            placeholder="you@example.com"
            autoComplete="email"
          />
        </div>
        {errors.email && (
          <p className="text-rose-600 text-xs font-semibold mt-1">{errors.email.message}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
          Password
        </label>
        <div className="relative">
          <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type={showPassword ? "text" : "password"}
            {...register("password")}
            className="w-full border border-slate-200 bg-white rounded-xl pl-10 pr-10 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition-all placeholder:text-slate-400 shadow-2xs"
            placeholder="Enter your password"
            autoComplete="current-password"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
            tabIndex={-1}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {errors.password && (
          <p className="text-rose-600 text-xs font-semibold mt-1">{errors.password.message}</p>
        )}
      </div>

      {errors.root && (
        <div className="flex items-start gap-3 bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-xl text-xs font-medium animate-in fade-in">
          <AlertCircle size={17} className="mt-0.5 shrink-0" />
          <div className="space-y-1 min-w-0">
            <p className="font-semibold">{errors.root.message}</p>
            {(errors.root as any).originalError && (
              <p className="text-[11px] opacity-90 font-mono break-all">
                {(errors.root as any).originalError}
              </p>
            )}
          </div>
        </div>
      )}

      <Button
        type="submit"
        variant="primary"
        size="lg"
        isLoading={isSubmitting}
        rightIcon={!isSubmitting ? <ArrowRight size={16} /> : undefined}
        className="w-full justify-center shadow-md shadow-emerald-600/15 mt-2"
      >
        Sign In to Portal
      </Button>

      <p className="text-center text-xs font-medium text-slate-400 pt-2">
        Protected ERP Portal • Contact administrator for access
      </p>
    </form>
  );
}

