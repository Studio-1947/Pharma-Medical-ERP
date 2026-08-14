"use client";

// The whole shell is client-rendered, auth-gated UI — there is nothing to
// statically prerender. Forcing dynamic rendering also sidesteps a Next
// 15.0.0 prerender bug where the shared Providers chunk resolves React to
// null and `next build` fails on these pages.
export const dynamic = "force-dynamic";

import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/shared/app-shell";
import { apiClient } from "@/lib/api-client";

/**
 * Shell layout for the whole (shell) route group.
 *
 * The billing area is special: when the new billing flow (patient-first
 * counter desk) is active, /billing and /billing/pos render full-screen —
 * no sidebar, no top header, no mobile bottom nav — so the counter desk is a
 * focused one-place workspace. Every other module keeps the normal chrome.
 */
function ShellContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Same setting the billing page reads; the counter desk and POS are the only
  // routes that go full-screen. The query is cheap (single row, cached) and
  // this layout re-renders both on route change and on flow switch.
  const { data: settingsRaw } = useQuery({
    queryKey: ["billing-flow"],
    queryFn: () => apiClient.get("/settings") as any,
    retry: 1,
  });
  // The patient-first counter desk is the default experience — a missing
  // setting (or an unreachable API) falls back to "new", matching the
  // billing and POS pages and the backend's SettingsService default.
  const billingFlow: "old" | "new" =
    (settingsRaw as any)?.data?.billingFlow === "old" ? "old" : "new";

  const isBillingRoute =
    pathname === "/billing" || pathname.startsWith("/billing/");
  const fullscreen = billingFlow === "new" && isBillingRoute;

  return <AppShell fullscreen={fullscreen}>{children}</AppShell>;
}

export default function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ShellContent>{children}</ShellContent>;
}
