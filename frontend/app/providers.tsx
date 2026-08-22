"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { ToastProvider } from "@/components/ui/toast";
import { bootstrapSession } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth.store";
import { NavigationProgress } from "@/components/shared/navigation-progress";
import { NavigationProvider } from "@/lib/navigation-context";

/** Backoff schedule used while the API is unreachable, in milliseconds. */
const BOOTSTRAP_RETRY_DELAYS = [2_000, 5_000, 15_000, 30_000];

function SessionBootstrap({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, logout } = useAuthStore();
  const settled = useRef(false);
  const attempt = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isAuthenticated || settled.current) return;

    let cancelled = false;

    // Proactively refresh the access token on app load. This prevents the
    // "401 storm -> 400 on refresh" glitch that occurs when the 15-min access
    // token has expired but the app still has valid stored state.
    const run = () => {
      bootstrapSession().then((result) => {
        if (cancelled) return;

        if (result === "unreachable") {
          // A deploy is in flight or the device is offline. Hold the session and
          // keep retrying rather than signing the user out of a live shift.
          const delay =
            BOOTSTRAP_RETRY_DELAYS[
              Math.min(attempt.current, BOOTSTRAP_RETRY_DELAYS.length - 1)
            ];
          attempt.current += 1;
          timerRef.current = setTimeout(run, delay);
          return;
        }

        settled.current = true;

        if (result === "unauthorized") {
          logout();
          // Clearing the session is not enough to leave the page. Nothing on a
          // protected route re-checks auth on its own: middleware only runs on
          // a navigation, and the dashboard renders its skeleton whenever the
          // store has no role, so it never mounts and never fires the request
          // whose 401 would have redirected. Without this the operator is left
          // watching an empty skeleton indefinitely — which is what a rejected
          // refresh after a deploy looked like.
          //
          // A full location assignment, not router.push: the session is gone,
          // so every cached query and store in this document is stale and the
          // document should be rebuilt rather than re-rendered.
          if (typeof window !== "undefined" && !pathname.startsWith("/login")) {
            const from = encodeURIComponent(pathname);
            window.location.href = `/login?from=${from}`;
          }
          return;
        }

        if (pathname === "/login") {
          const params = new URLSearchParams(window.location.search);
          const from = params.get("from") ?? "/dashboard";
          router.push(from as any);
        }
      });
    };

    // Coming back online is the strongest signal that a retry will succeed.
    const onOnline = () => {
      if (settled.current || cancelled) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      attempt.current = 0;
      run();
    };

    run();
    window.addEventListener("online", onOnline);

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      window.removeEventListener("online", onOnline);
    };
  }, [isAuthenticated, logout, pathname, router]);

  return <>{children}</>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 1000 * 60 * 5,
            gcTime: 1000 * 60 * 10,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <NavigationProvider>
        <ToastProvider>
          <NavigationProgress />
          <SessionBootstrap>{children}</SessionBootstrap>
        </ToastProvider>
      </NavigationProvider>
    </QueryClientProvider>
  );
}
