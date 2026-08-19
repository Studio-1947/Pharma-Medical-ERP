import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

export const apiClient = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

// Read token from the direct localStorage key, falling back to the Zustand
// persist store so the two never drift apart after a page reload.
function getStoredToken(key: "pharmerp_access_token" | "pharmerp_refresh_token"): string | null {
  if (typeof window === "undefined") return null;
  const direct = localStorage.getItem(key);
  if (direct) return direct;
  try {
    const store = JSON.parse(localStorage.getItem("pharmerp-auth") ?? "{}");
    const storeKey = key === "pharmerp_access_token" ? "accessToken" : "refreshToken";
    return (store?.state?.[storeKey] as string | null | undefined) ?? null;
  } catch {
    return null;
  }
}

// Attach access token to every outgoing request
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getStoredToken("pharmerp_access_token");
  if (token) config.headers["Authorization"] = `Bearer ${token}`;
  return config;
});

/**
 * The API's health probe. It sits at the server root, outside the /api/v1
 * prefix that BASE_URL points at.
 */
const HEALTH_URL = BASE_URL.replace(/\/api\/v\d+\/?$/, "") + "/health";

/** Statuses a proxy returns while the API behind it is not answering. */
const GATEWAY_DOWN = new Set([502, 503, 504]);

/** One reachability check at a time, however many requests fail at once. */
let checkingReachability = false;

/**
 * Ends the session when the API is genuinely down, rather than on a single
 * failed request.
 *
 * Two guards keep this from firing when it should not:
 *  - a browser that is offline is expected to fail every call, and the counter
 *    is meant to keep billing into the offline queue, so it is left alone;
 *  - the failure is confirmed against /health before the session is ended, so
 *    one unlucky request cannot sign a counter out.
 *
 * It still signs the user out when the API really is down (a deploy restart
 * included) -- landing on /login requires clearing the session, since
 * middleware sends a cookie holder straight back to /dashboard.
 */
async function endSessionIfApiIsDown() {
  if (typeof window === "undefined") return;
  if (checkingReachability) return;
  if (!navigator.onLine) return;
  if (window.location.pathname.startsWith("/login")) return;

  checkingReachability = true;
  try {
    await axios.get(HEALTH_URL, { timeout: 4000 });
  } catch {
    if (navigator.onLine) clearAuthAndRedirect();
  } finally {
    checkingReachability = false;
  }
}

/** A failure that means "no API answered", as opposed to one it rejected. */
function looksUnreachable(error: AxiosError): boolean {
  if (!error.response) return true;
  return GATEWAY_DOWN.has(error.response.status);
}

let isRefreshing = false;
let failedQueue: Array<{
  resolve: (v: string) => void;
  reject: (e: unknown) => void;
}> = [];

function processQueue(error: unknown, token: string | null) {
  failedQueue.forEach((p) => (error ? p.reject(error) : p.resolve(token!)));
  failedQueue = [];
}

function clearAuthAndRedirect() {
  // An impersonation session deliberately carries no refresh token, so it
  // always ends up here when its short-lived access token expires. Restoring
  // the stashed super_admin session is the correct outcome — signing the
  // operator out of their own account is not. Dynamic import avoids a module
  // cycle, since impersonation.ts imports apiClient.
  if (
    typeof window !== "undefined" &&
    sessionStorage.getItem("pharmerp_impersonation_origin")
  ) {
    import("./impersonation").then((m) => {
      // callApi: false — the token is already dead, so the STOP row cannot be
      // written with it. A missing STOP row means "expired", not "still open".
      m.stopImpersonation({ callApi: false });
      window.location.href = "/admin/users";
    });
    return;
  }

  localStorage.removeItem("pharmerp_access_token");
  localStorage.removeItem("pharmerp_refresh_token");
  // Clear Zustand auth state so the store doesn't re-set the session cookie
  try {
    const raw = JSON.parse(localStorage.getItem("pharmerp-auth") ?? "{}");
    if (raw?.state) {
      raw.state.accessToken = null;
      raw.state.refreshToken = null;
      raw.state.isAuthenticated = false;
      localStorage.setItem("pharmerp-auth", JSON.stringify(raw));
    }
  } catch {}
  if (typeof document !== "undefined") {
    document.cookie = "pharmerp_session=; path=/; max-age=0; SameSite=Lax";
  }
  window.location.href = "/login";
}

// Auto-refresh access token on 401
apiClient.interceptors.response.use(
  (res) => res.data,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };
    if (error.response?.status !== 401 || original._retry) {
      // Fire-and-forget: the caller still gets its rejection, and the redirect
      // only happens once /health confirms the API is gone.
      if (looksUnreachable(error)) void endSessionIfApiIsDown();
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      }).then((token) => {
        original.headers["Authorization"] = `Bearer ${token}`;
        return apiClient(original);
      });
    }

    original._retry = true;
    isRefreshing = true;

    try {
      const refreshToken = getStoredToken("pharmerp_refresh_token");

      if (!refreshToken) {
        processQueue(new Error("No refresh token"), null);
        clearAuthAndRedirect();
        return Promise.reject(new Error("No refresh token"));
      }

      const res: any = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken });
      // TransformInterceptor spreads the payload to the top level, so tokens
      // are available both at res.data.accessToken and res.data.data.accessToken
      const newAccess: string = res.data?.accessToken ?? res.data?.data?.accessToken;
      const newRefresh: string = res.data?.refreshToken ?? res.data?.data?.refreshToken;

      if (!newAccess) throw new Error("Refresh response missing accessToken");

      localStorage.setItem("pharmerp_access_token", newAccess);
      if (newRefresh) localStorage.setItem("pharmerp_refresh_token", newRefresh);

      // Update default headers AND the original request's header so the retry
      // never sends the old expired token regardless of Axios config caching.
      apiClient.defaults.headers["Authorization"] = `Bearer ${newAccess}`;
      original.headers["Authorization"] = `Bearer ${newAccess}`;

      // Keep the Zustand store in sync so the in-memory state never goes stale.
      try {
        const raw = JSON.parse(localStorage.getItem("pharmerp-auth") ?? "{}");
        if (raw?.state) {
          raw.state.accessToken = newAccess;
          if (newRefresh) raw.state.refreshToken = newRefresh;
          localStorage.setItem("pharmerp-auth", JSON.stringify(raw));
        }
      } catch {}

      if (typeof document !== "undefined") {
        document.cookie = "pharmerp_session=1; path=/; max-age=604800; SameSite=Lax";
      }

      processQueue(null, newAccess);
      return apiClient(original);
    } catch (err) {
      processQueue(err, null);
      clearAuthAndRedirect();
      return Promise.reject(err);
    } finally {
      isRefreshing = false;
    }
  },
);

// Exported so the session bootstrap can call a token refresh explicitly
/**
 * Outcome of a session bootstrap.
 *
 * `unreachable` exists so a transport failure is never mistaken for a rejected
 * session. During a deploy the API container restarts and this call fails with
 * a network error or a 502 from nginx; treating that as "signed out" logs every
 * open client out mid-shift. Only an explicit auth rejection ends the session.
 */
export type BootstrapResult = "ok" | "unauthorized" | "unreachable";

export async function bootstrapSession(): Promise<BootstrapResult> {
  const refreshToken = getStoredToken("pharmerp_refresh_token");
  if (!refreshToken) return "unauthorized";
  try {
    const res: any = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken });
    const newAccess: string = res.data?.accessToken ?? res.data?.data?.accessToken;
    const newRefresh: string = res.data?.refreshToken ?? res.data?.data?.refreshToken;

    if (!newAccess) return "unauthorized";

    localStorage.setItem("pharmerp_access_token", newAccess);
    if (newRefresh) localStorage.setItem("pharmerp_refresh_token", newRefresh);
    apiClient.defaults.headers["Authorization"] = `Bearer ${newAccess}`;

    // Keep the Zustand store in sync so the in-memory state never goes stale.
    try {
      const raw = JSON.parse(localStorage.getItem("pharmerp-auth") ?? "{}");
      if (raw?.state) {
        raw.state.accessToken = newAccess;
        if (newRefresh) raw.state.refreshToken = newRefresh;
        localStorage.setItem("pharmerp-auth", JSON.stringify(raw));
      }
    } catch {}

    if (typeof document !== "undefined") {
      document.cookie = "pharmerp_session=1; path=/; max-age=604800; SameSite=Lax";
    }

    return "ok";
  } catch (err) {
    const status = (err as AxiosError)?.response?.status;

    // No response at all, or a gateway/5xx from a restarting backend: the
    // session may well still be valid, so keep it and let the caller retry.
    if (status === undefined || status >= 500) return "unreachable";

    // 401/403 (and a 400 from a consumed refresh token) are real rejections.
    return "unauthorized";
  }
}

export const queryKeys = {
  medicines: {
    all: () => ["medicines"] as const,
    list: (params: object) => ["medicines", "list", params] as const,
    detail: (id: string) => ["medicines", id] as const,
    batches: (id: string) => ["medicines", id, "batches"] as const,
  },
  patients: {
    all: () => ["patients"] as const,
    list: (params: object) => ["patients", "list", params] as const,
    detail: (id: string) => ["patients", id] as const,
  },
  invoices: {
    all: () => ["invoices"] as const,
    list: (params: object) => ["invoices", "list", params] as const,
    detail: (id: string) => ["invoices", id] as const,
  },
  users: {
    all: () => ["users"] as const,
    list: (params: object) => ["users", "list", params] as const,
    detail: (id: string) => ["users", id] as const,
  },
  admin: {
    all: () => ["admin"] as const,
    overview: () => ["admin", "overview"] as const,
    auditLogs: (params: object) => ["admin", "audit-logs", params] as const,
    auditActions: () => ["admin", "audit-actions"] as const,
    sessions: (params: object) => ["admin", "sessions", params] as const,
  },
  branches: {
    all: () => ["branches"] as const,
    detail: (id: string) => ["branches", id] as const,
  },
  prescriptions: {
    all: () => ["prescriptions"] as const,
    list: (params: object) => ["prescriptions", "list", params] as const,
    detail: (id: string) => ["prescriptions", id] as const,
  },
  suppliers: {
    all: () => ["suppliers"] as const,
    list: (params: object) => ["suppliers", "list", params] as const,
    detail: (id: string) => ["suppliers", id] as const,
  },
  purchaseOrders: {
    all: () => ["purchaseOrders"] as const,
    list: (params: object) => ["purchaseOrders", "list", params] as const,
    detail: (id: string) => ["purchaseOrders", id] as const,
  },
  employees: {
    all: () => ["employees"] as const,
    list: (params: object) => ["employees", "list", params] as const,
    detail: (id: string) => ["employees", id] as const,
  },
  notifications: {
    all: () => ["notifications"] as const,
    list: (params: object) => ["notifications", "list", params] as const,
    unreadCount: () => ["notifications", "unread-count"] as const,
  },
  clinicTokens: {
    all: () => ["clinic-tokens"] as const,
    list: (params: object) => ["clinic-tokens", "list", params] as const,
    detail: (id: string) => ["clinic-tokens", id] as const,
    doctors: () => ["clinic-doctors"] as const,
    // A doctor's curated medicine list. Keyed by branch as well because the
    // stock figure on each row is branch-specific.
    doctorMedicines: (doctorId: string, branchId?: string) =>
      ["clinic-doctors", doctorId, "medicines", branchId ?? "all"] as const,
    doctorMedicinesAll: (doctorId: string) =>
      ["clinic-doctors", doctorId, "medicines"] as const,
  },
};
