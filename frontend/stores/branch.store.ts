"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Branch {
  id: string;
  name: string;
  code: string;
}

interface BranchState {
  activeBranch: Branch | null;
  branches: Branch[];
  setActiveBranch: (branch: Branch) => void;
  setBranches: (branches: Branch[]) => void;
  clearBranch: () => void;
}

export const useBranchStore = create<BranchState>()(
  persist(
    (set) => ({
      activeBranch: null,
      branches: [],

      setActiveBranch: (branch) => set({ activeBranch: branch }),

      setBranches: (branches) =>
        set((state) => ({
          branches,
          // Auto-select first branch if none active yet
          activeBranch: state.activeBranch ?? branches[0] ?? null,
        })),

      clearBranch: () => set({ activeBranch: null, branches: [] }),
    }),
    {
      name: "pharmerp-branch",
      partialize: (s) => ({ activeBranch: s.activeBranch }),
    },
  ),
);
