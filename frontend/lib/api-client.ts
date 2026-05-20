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
export async function bootstrapSession(): Promise<boolean> {
  const refreshToken = getStoredToken("pharmerp_refresh_token");
  if (!refreshToken) return false;
  try {
    const res: any = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken });
    const newAccess: string = res.data?.accessToken ?? res.data?.data?.accessToken;
    const newRefresh: string = res.data?.refreshToken ?? res.data?.data?.refreshToken;

    if (!newAccess) return false;

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

    return true;
  } catch {
    return false;
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
    detail: (id: string) => ["users", id] as const,
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
};
