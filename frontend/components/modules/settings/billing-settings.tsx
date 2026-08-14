"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Receipt,
  ShoppingCart,
  UserSearch,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth.store";
import { useToast } from "@/components/ui/toast";

type BillingFlow = "old" | "new";

/**
 * Billing flow switch — super admin only.
 *
 * "Old billing" is the classic medicine-first POS terminal at /billing/pos.
 * "New billing" is the patient-first counter desk: search a patient by mobile
 * number, then open the POS preloaded with that patient.
 *
 * The old flow is never removed — it stays reachable from the new flow's
 * screen, so a branch can fall back to it at any moment. The switch just
 * decides which experience the /billing page lands on for everyone.
 */
export function BillingSettings() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const { success: toastSuccess, error: toastError } = useToast();
  const [pendingFlow, setPendingFlow] = useState<BillingFlow | null>(null);

  const isSuperAdmin = user?.role === "super_admin";

  const { data: settingsRaw, isLoading } = useQuery({
    queryKey: ["app-settings"],
    queryFn: () => apiClient.get("/settings") as Promise<any>,
    enabled: isSuperAdmin,
    retry: 1,
  });

  // The patient-first counter desk is the default — the UI shows it as active
  // until the real value loads, and falls back to "new" if the API is down.
  const currentFlow: BillingFlow = (settingsRaw as any)?.data?.billingFlow ?? "new";

  const mutation = useMutation({
    mutationFn: (flow: BillingFlow) =>
      apiClient.put("/settings/billing-flow", { flow }),
    onSuccess: (_, flow) => {
      qc.invalidateQueries({ queryKey: ["app-settings"] });
      qc.invalidateQueries({ queryKey: ["billing-flow"] });
      toastSuccess(
        flow === "new" ? "New billing enabled" : "Legacy billing enabled",
        flow === "new"
          ? "The billing page now opens the patient-first counter desk. The old POS stays available from there."
          : "The billing page now opens the classic medicine-first POS terminal.",
      );
    },
    onError: (err: any) => {
      toastError(
        "Could not switch billing flow",
        err?.response?.data?.message ?? "Only a super admin can change this setting.",
      );
    },
  });

  if (!isSuperAdmin) {
    return (
      <div className="rounded-xl border bg-white p-6 text-sm text-slate-500 flex items-center gap-2">
        <ShieldCheck size={16} className="text-slate-400" />
        Only a super admin can change the billing flow.
      </div>
    );
  }

  const switchFlow = (flow: BillingFlow) => {
    setPendingFlow(flow);
    mutation.mutate(flow, { onSettled: () => setPendingFlow(null) });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-800 text-sm">
              Billing Flow
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              The patient-first counter desk is the default billing experience.
              Super admins can fall back to the legacy POS from here.
            </p>
          </div>
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-teal-50 text-teal-700 border border-teal-200 text-[11px] font-bold">
            <ShieldCheck size={12} /> Super Admin only
          </span>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground animate-pulse">
            Loading current billing flow…
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-5">
            {/* Legacy POS */}
            <button
              type="button"
              onClick={() => switchFlow("old")}
              disabled={mutation.isPending}
              className={`relative text-left rounded-2xl border-2 p-5 transition-all ${
                currentFlow === "old"
                  ? "border-emerald-500 bg-emerald-50/60 shadow-sm"
                  : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700 shrink-0">
                  <ShoppingCart size={18} />
                </div>
                {currentFlow === "old" && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-extrabold uppercase tracking-wide">
                    Active
                  </span>
                )}
              </div>
              <h4 className="mt-3 font-bold text-slate-800 text-sm">
                Old Billing (Legacy POS)
              </h4>
              <p className="mt-1 text-xs text-slate-500 leading-relaxed">
                Classic medicine-first terminal. Search a medicine or scan a
                barcode, build the cart, checkout. The switch is
                installation-wide: turning old billing on moves every branch
                back to this screen; the counter desk returns the moment you
                switch back.
              </p>
              {pendingFlow === "old" && (
                <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                  <span className="w-3 h-3 border-2 border-emerald-300 border-t-emerald-700 rounded-full animate-spin" />
                  Switching…
                </span>
              )}
            </button>

            {/* Patient-first counter desk */}
            <button
              type="button"
              onClick={() => switchFlow("new")}
              disabled={mutation.isPending}
              className={`relative text-left rounded-2xl border-2 p-5 transition-all ${
                currentFlow === "new"
                  ? "border-orange-500 bg-orange-50/60 shadow-sm"
                  : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center text-orange-700 shrink-0">
                  <UserSearch size={18} />
                </div>
                {currentFlow === "new" && (
                  <span className="px-2 py-0.5 rounded-full bg-orange-600 text-white text-[10px] font-extrabold uppercase tracking-wide">
                    Active
                  </span>
                )}
              </div>
              <h4 className="mt-3 font-bold text-slate-800 text-sm flex items-center gap-1.5">
                New Billing (Patient-First)
                <Sparkles size={13} className="text-orange-500" />
              </h4>
              <p className="mt-1 text-xs text-slate-500 leading-relaxed">
                Counter desk flow. Search the patient by mobile number first,
                then the POS opens with that patient preloaded. OTC meds sell
                straight from the same screen as a walk-in, no patient needed.
                Old POS stays reachable too.
              </p>
              {pendingFlow === "new" && (
                <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-orange-700">
                  <span className="w-3 h-3 border-2 border-orange-300 border-t-orange-700 rounded-full animate-spin" />
                  Switching…
                </span>
              )}
            </button>
          </div>
        )}

        {mutation.isError && (
          <div className="mx-5 mb-4 flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertCircle size={14} />
            {mutation.error instanceof Error
              ? mutation.error.message
              : "Failed to save the billing flow setting."}
          </div>
        )}
        {mutation.isSuccess && (
          <div className="mx-5 mb-4 flex items-center gap-2 text-green-600 text-sm bg-green-50 border border-green-200 rounded-lg px-3 py-2">
            <CheckCircle2 size={14} />
            Billing flow updated for all branches.
          </div>
        )}
      </div>

      <div className="rounded-xl border bg-white p-5">
        <h4 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
          <Receipt size={15} className="text-emerald-600" />
          What changes
        </h4>
        <ul className="mt-3 space-y-2 text-xs text-slate-600">
          <li className="flex items-start gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1 shrink-0" />                The new patient-first desk is the default for everyone — shop
                managers see it without any switch.
              </li>
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1 shrink-0" />
                The switch is global for everyone in the installation — old
                billing moves all roles back to the classic POS, not just super
                admins.
              </li>
          <li className="flex items-start gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1 shrink-0" />
            New billing only changes the entry screen — checkout, stock, Rx and
            payment handling are identical.
          </li>
          <li className="flex items-start gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1 shrink-0" />
            OTC / walk-in sales never need a patient — a dedicated entry on the
            counter desk opens the POS with no patient linked.
          </li>
        </ul>
      </div>
    </div>
  );
}
