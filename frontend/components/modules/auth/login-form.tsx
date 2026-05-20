"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import { loginSchema, type LoginDto } from "@pharmerp/types";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth.store";
import Link from "next/link";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isRegistered = searchParams.get("registered") === "true";
  const { setTokens, setUser } = useAuthStore();

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
        // @ts-ignore - passing extra fields for UI display
        originalError: errorData?.originalError,
        stack: errorData?.stack,
      });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {isRegistered && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm mb-4 animate-in fade-in slide-in-from-top-1">
          Registration successful! Please sign in with your credentials.
        </div>
      )}
      <div>
        <label className="block text-sm font-medium mb-1">Email</label>
        <input
          type="email"
          {...register("email")}
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          placeholder="admin@pharmerp.com"
        />
        {errors.email && (
          <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Password</label>
        <input
          type="password"
          {...register("password")}
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          placeholder="Min 8 characters"
        />
        {errors.password && (
          <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>
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
        className="w-full bg-primary text-primary-foreground py-2 rounded-lg font-medium text-sm hover:opacity-90 disabled:opacity-60 transition-opacity"
      >
        {isSubmitting ? "Signing in..." : "Sign in"}
      </button>

      <div className="text-center mt-4">
        <p className="text-sm text-muted-foreground">
          Don't have an account?{" "}
          <Link href="/signup" className="text-primary hover:underline font-medium">
            Sign up
          </Link>
        </p>
      </div>
    </form>
  );
}
