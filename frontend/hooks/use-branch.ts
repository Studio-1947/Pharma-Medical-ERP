"use client";

import { useAuthStore } from "@/stores/auth.store";
import { useBranchStore } from "@/stores/branch.store";

export function useBranch() {
  const { activeBranch, branches, setActiveBranch, setBranches } =
    useBranchStore();

  return { activeBranch, branches, setActiveBranch, setBranches };
}

/**
 * The branchId a write should carry, and whether the user still has to choose.
 *
 * Only super_admin sends one: every other role is pinned to its own branch by
 * resolveBranchScope, and sending a branchId that differs from theirs is a 403.
 * So for them this returns undefined and the server fills it in.
 *
 * `needsSelection` is true when a super_admin has not picked a branch yet —
 * callers use it to block submit with a useful message instead of letting the
 * API return "branchId is required - super_admin must select a branch".
 */
export function useActiveBranchId(): {
  branchId: string | undefined;
  needsSelection: boolean;
} {
  const { user } = useAuthStore();
  const { activeBranch } = useBranchStore();

  if (user?.role !== "super_admin") {
    return { branchId: undefined, needsSelection: false };
  }

  return {
    branchId: activeBranch?.id,
    needsSelection: !activeBranch,
  };
}
