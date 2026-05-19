"use client";

import { useAuthStore } from "@/stores/auth.store";

export function useAuth() {
  const { user, accessToken, isAuthenticated, setTokens, setUser, logout } =
    useAuthStore();

  return { user, accessToken, isAuthenticated, setTokens, setUser, logout };
}
