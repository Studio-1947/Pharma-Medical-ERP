"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { ToastProvider } from "@/components/ui/toast";
import { bootstrapSession } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth.store";

function SessionBootstrap({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, logout } = useAuthStore();
  const bootstrapped = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || bootstrapped.current) return;
    bootstrapped.current = true;

    // Proactively refresh the access token on app load.
    // This prevents the "401 storm → 400 on refresh" glitch that occurs when the
    // 15-min access token has expired but the app still has valid stored state.
    bootstrapSession().then((ok) => {
      if (!ok) logout();
    });
  }, [isAuthenticated, logout]);

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
      <ToastProvider>
        <SessionBootstrap>{children}</SessionBootstrap>
      </ToastProvider>
    </QueryClientProvider>
  );
}
