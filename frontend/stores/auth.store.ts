"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface User {
  id: string;
  email: string;
  role: string;
  branchId?: string;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  setTokens: (access: string, refresh: string) => void;
  setUser: (user: User) => void;
  logout: () => void;
}

function setSessionCookie() {
  if (typeof document === "undefined") return;
  document.cookie = "pharmerp_session=1; path=/; max-age=604800; SameSite=Lax";
}

function clearSessionCookie() {
  if (typeof document === "undefined") return;
  document.cookie = "pharmerp_session=; path=/; max-age=0; SameSite=Lax";
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,

      setTokens: (access, refresh) => {
        set({ accessToken: access, refreshToken: refresh, isAuthenticated: true });
        if (typeof window !== "undefined") {
          localStorage.setItem("pharmerp_access_token", access);
          localStorage.setItem("pharmerp_refresh_token", refresh);
          setSessionCookie();
        }
      },

      setUser: (user) => set({ user }),

      logout: () => {
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
        });
        if (typeof window !== "undefined") {
          localStorage.removeItem("pharmerp_access_token");
          localStorage.removeItem("pharmerp_refresh_token");
          clearSessionCookie();
        }
      },
    }),
    {
      name: "pharmerp-auth",
      partialize: (s) => ({
        user: s.user,
        accessToken: s.accessToken,
        refreshToken: s.refreshToken,
        isAuthenticated: s.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        // Re-sync cookie after hydration from localStorage
        if (state?.isAuthenticated) setSessionCookie();
      },
    },
  ),
);
