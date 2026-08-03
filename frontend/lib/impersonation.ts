"use client";

import { apiClient } from "@/lib/api-client";
import { useAuthStore, type User } from "@/stores/auth.store";

/**
 * Client half of impersonation.
 *
 * Tokens live in three places that must stay in sync: the direct localStorage
 * keys, the `pharmerp-auth` zustand persist blob, and apiClient.defaults.
 * getStoredToken() in api-client.ts reads the direct key first and falls back
 * to the blob, so writing only one of them leaves the other authoritative on
 * the next reload.
 */

export const IMPERSONATION_ORIGIN_KEY = "pharmerp_impersonation_origin";

const ACCESS_KEY = "pharmerp_access_token";
const REFRESH_KEY = "pharmerp_refresh_token";
const PERSIST_KEY = "pharmerp-auth";

export interface ImpersonationTarget {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  role: string;
  branchId?: string | null;
}

export interface ImpersonationStartResponse {
  accessToken: string;
  expiresAt: string;
  sid: string;
  target: ImpersonationTarget;
  actor: { id: string; email: string };
}

interface OriginStash {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  target: ImpersonationTarget;
  actor: { id: string; email: string };
  sid: string;
  expiresAt: string;
}

function readPersistBlob(): any {
  try {
    return JSON.parse(localStorage.getItem(PERSIST_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function writePersistBlob(mutate: (state: any) => void) {
  const blob = readPersistBlob();
  if (!blob?.state) return;
  mutate(blob.state);
  localStorage.setItem(PERSIST_KEY, JSON.stringify(blob));
}

/** Swaps the live session for the impersonation token, stashing the original. */
export function startImpersonation(res: ImpersonationStartResponse) {
  if (typeof window === "undefined") return;

  // sessionStorage, not localStorage: the stash must die with the tab so a
  // closed browser cannot leave a super_admin refresh token recoverable later.
  const stash: OriginStash = {
    accessToken: localStorage.getItem(ACCESS_KEY),
    refreshToken: localStorage.getItem(REFRESH_KEY),
    user: useAuthStore.getState().user,
    target: res.target,
    actor: res.actor,
    sid: res.sid,
    expiresAt: res.expiresAt,
  };
  sessionStorage.setItem(IMPERSONATION_ORIGIN_KEY, JSON.stringify(stash));

  // Removing the refresh token is what makes token laundering unreachable from
  // the client: POST /auth/refresh would otherwise return a clean, act-free,
  // full-length token, and the 401 interceptor would call it automatically.
  localStorage.setItem(ACCESS_KEY, res.accessToken);
  localStorage.removeItem(REFRESH_KEY);
  writePersistBlob((s) => {
    s.accessToken = res.accessToken;
    s.refreshToken = null;
  });
  apiClient.defaults.headers["Authorization"] = `Bearer ${res.accessToken}`;

  // usePermissions derives from user.role, so this alone collapses the sidebar
  // and the AppShell route gate down to the target's permissions.
  useAuthStore.getState().setUser({
    id: res.target.id,
    email: res.target.email,
    role: res.target.role,
    branchId: res.target.branchId ?? undefined,
  });
  // The pharmerp_session cookie is left alone — middleware only checks presence.
}

/**
 * Restores the operator's own session.
 *
 * `callApi: false` is used when the impersonation token has already expired —
 * POST /admin/impersonate/stop would 401, and the START row plus the token's
 * own exp already bound the session in the audit trail.
 */
export function stopImpersonation(opts: { callApi?: boolean } = {}): boolean {
  if (typeof window === "undefined") return false;
  const raw = sessionStorage.getItem(IMPERSONATION_ORIGIN_KEY);
  if (!raw) return false;

  let origin: OriginStash;
  try {
    origin = JSON.parse(raw);
  } catch {
    sessionStorage.removeItem(IMPERSONATION_ORIGIN_KEY);
    return false;
  }

  // Best-effort audit row; never block the restore on it.
  // The empty object is required, not cosmetic: apiClient sets a default
  // Content-Type of application/json, and Fastify rejects a JSON-typed POST
  // with no body as a 400 before the handler ever runs.
  if (opts.callApi !== false) {
    apiClient.post("/admin/impersonate/stop", {}).catch(() => {});
  }

  if (origin.accessToken) localStorage.setItem(ACCESS_KEY, origin.accessToken);
  if (origin.refreshToken) localStorage.setItem(REFRESH_KEY, origin.refreshToken);
  writePersistBlob((s) => {
    s.accessToken = origin.accessToken;
    s.refreshToken = origin.refreshToken;
    s.isAuthenticated = true;
    s.user = origin.user;
  });
  if (origin.accessToken) {
    apiClient.defaults.headers["Authorization"] = `Bearer ${origin.accessToken}`;
  }
  if (origin.user) useAuthStore.getState().setUser(origin.user);
  document.cookie = "pharmerp_session=1; path=/; max-age=604800; SameSite=Lax";

  sessionStorage.removeItem(IMPERSONATION_ORIGIN_KEY);
  return true;
}

export function getImpersonationState(): OriginStash | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(IMPERSONATION_ORIGIN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OriginStash;
  } catch {
    return null;
  }
}

export function isImpersonating(): boolean {
  return getImpersonationState() !== null;
}
