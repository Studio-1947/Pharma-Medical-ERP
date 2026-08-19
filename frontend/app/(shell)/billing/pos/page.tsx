"use client";

import { Suspense, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { PosTerminal } from "@/components/modules/billing/pos-terminal";
import { StuckSalesBanner } from "@/components/modules/billing/stuck-sales-banner";
import { RxPendingBanner } from "@/components/modules/billing/rx-pending-banner";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth.store";

export default function PosPage() {
  const router = useRouter();
  const { user } = useAuthStore();

  const { data: settingsRaw, isFetched } = useQuery({
    queryKey: ["billing-flow"],
    queryFn: () => apiClient.get("/settings") as any,
    retry: 1,
  });
  const billingFlow: "old" | "new" =
    (settingsRaw as any)?.data?.billingFlow === "old" ? "old" : "new";

  // When the new billing flow is active the classic POS is never shown to
  // shop managers — payment happens inline on the counter desk page. Any
  // attempt to open /billing/pos sends them back to the desk. Super admins
  // keep the classic POS via their Open Classic POS link.
  //
  // The redirect runs in an effect, never during render — calling
  // router.replace() while PosPage is rendering triggers React's
  // "Cannot update a component while rendering a different component" error.
  const isSuperAdmin = user?.role === "super_admin";
  const shouldRedirect = isFetched && billingFlow === "new" && !isSuperAdmin;

  useEffect(() => {
    if (shouldRedirect) router.replace("/billing");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldRedirect]);

  // The classic POS never renders until the billing-flow setting has loaded:
  // a shop manager in the new flow must not see even a frame of the legacy
  // terminal before the redirect kicks in (direct URLs, bookmarks, history).
  // Once the query settles we either redirect or show the terminal — never both.
  if (!isFetched) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] text-sm text-slate-400">
        Loading billing flow…
      </div>
    );
  }

  // While the redirect is pending, show a brief placeholder instead of the
  // classic POS so shop managers never see a flash of it.
  if (shouldRedirect) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] text-sm text-slate-400">
        Taking you to the counter desk…
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Offline sales the server has refused have nowhere else to appear, and
          money may already have been taken for them. */}
      <StuckSalesBanner />
      <RxPendingBanner />
      <Suspense
        fallback={
          <div className="p-8 text-sm text-slate-500 animate-pulse">Loading Point of Sale…</div>
        }
      >
        <PosTerminal />
      </Suspense>
    </div>
  );
}
