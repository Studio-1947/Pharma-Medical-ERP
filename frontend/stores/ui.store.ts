"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UIState {
  sidebarCollapsed: boolean;
  posViewMode: "split" | "scale";
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setPosViewMode: (mode: "split" | "scale") => void;
  togglePosViewMode: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      posViewMode: "split",
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setPosViewMode: (mode) => set({ posViewMode: mode }),
      togglePosViewMode: () =>
        set((state) => ({ posViewMode: state.posViewMode === "split" ? "scale" : "split" })),
    }),
    {
      name: "pharmerp-ui-settings",
    }
  )
);
