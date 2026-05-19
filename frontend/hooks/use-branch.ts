"use client";

import { useBranchStore } from "@/stores/branch.store";

export function useBranch() {
  const { activeBranch, branches, setActiveBranch, setBranches } =
    useBranchStore();

  return { activeBranch, branches, setActiveBranch, setBranches };
}
