"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth.store";
import { useBranchStore, type Branch } from "@/stores/branch.store";
import { apiClient, queryKeys } from "@/lib/api-client";
import { Building2, Check, ChevronDown, AlertTriangle } from "lucide-react";

/**
 * Active-branch picker, rendered only for super_admin.
 *
 * super_admin is the one role with a null branchId — it is deliberately
 * unscoped so it can read across branches. But writes that have to land in a
 * specific branch (a clinic token, a warehouse) call requireBranchScope, which
 * refuses to guess and returns "branchId is required - super_admin must select
 * a branch for this action". Until now there was nowhere to make that choice,
 * so those writes were simply impossible as super_admin.
 *
 * Every other role is pinned to its own branch server-side, so showing them a
 * switcher would imply a control they do not have.
 */
export function BranchSwitcher() {
  const { user } = useAuthStore();
  const { activeBranch, setActiveBranch, setBranches } = useBranchStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const isSuperAdmin = user?.role === "super_admin";

  const { data } = useQuery({
    queryKey: queryKeys.branches.all(),
    queryFn: () => apiClient.get("/branches") as Promise<any>,
    enabled: isSuperAdmin,
    staleTime: 5 * 60_000,
  });

  const raw = data as any;
  const branches: Branch[] = (
    Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : []
  ).map((b: any) => ({ id: b.id, name: b.name, code: b.code }));

  // Mirror into the store so other screens can read the choice without
  // refetching. setBranches auto-selects the first branch when none is active,
  // which keeps a fresh super_admin session from starting in a broken state.
  useEffect(() => {
    if (branches.length > 0) setBranches(branches);
    // Comparing by id keeps this from re-running on every render's new array.
  }, [branches.map((b) => b.id).join(","), setBranches]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!isSuperAdmin) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors max-w-[200px]"
        title="Active branch — applies to actions that write to one branch"
      >
        {activeBranch ? (
          <Building2 size={14} className="text-emerald-600 shrink-0" />
        ) : (
          <AlertTriangle size={14} className="text-amber-500 shrink-0" />
        )}
        <span
          className={`text-[13px] font-medium truncate ${
            activeBranch ? "text-slate-700" : "text-amber-600"
          }`}
        >
          {activeBranch?.name ?? "Select branch"}
        </span>
        <ChevronDown size={13} className="text-slate-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-60 bg-white border border-slate-200 rounded-lg shadow-lg z-50 overflow-hidden">
          <div className="px-3 py-2 border-b bg-slate-50">
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
              Active Branch
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
              Used when creating records that belong to one branch.
            </p>
          </div>

          {branches.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted-foreground">
              No branches found.
            </p>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              {branches.map((b) => (
                <button
                  key={b.id}
                  onClick={() => {
                    setActiveBranch(b);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left transition-colors ${
                    activeBranch?.id === b.id ? "bg-emerald-50" : "hover:bg-slate-50"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-slate-700 truncate">
                      {b.name}
                    </p>
                    {b.code && (
                      <p className="text-[11px] text-slate-400">{b.code}</p>
                    )}
                  </div>
                  {activeBranch?.id === b.id && (
                    <Check size={14} className="text-emerald-600 shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
