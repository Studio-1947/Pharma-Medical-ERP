"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { ToastProvider } from "@/components/ui/toast";
import { bootstrapSession } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth.store";
import { NavigationProgress } from "@/components/shared/navigation-progress";
import { NavigationProvider } from "@/lib/navigation-context";

function SessionBootstrap({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, logout } = useAuthStore();
  const bootstrapped = useRef(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isAuthenticated || bootstrapped.current) return;
    bootstrapped.current = true;

    // Proactively refresh the access token on app load.
    // This prevents the "401 storm → 400 on refresh" glitch that occurs when the
    // 15-min access token has expired but the app still has valid stored state.
    bootstrapSession().then((ok) => {
      if (!ok) {
        logout();
      } else if (pathname === "/login") {
        const params = new URLSearchParams(window.location.search);
        const from = params.get("from") ?? "/dashboard";
        router.push(from as any);
      }
    });
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
