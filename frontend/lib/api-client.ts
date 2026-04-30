import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

export const apiClient = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

// Attach access token from localStorage
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token =
    typeof window !== "undefined"
      ? localStorage.getItem("pharmerp_access_token")
      : null;
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

// Auto-refresh on 401
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
      const refreshToken = localStorage.getItem("pharmerp_refresh_token");
      const res: any = await axios.post(`${BASE_URL}/auth/refresh`, {
        refreshToken,
      });
      const { accessToken, refreshToken: newRefresh } = res.data;
      localStorage.setItem("pharmerp_access_token", accessToken);
      localStorage.setItem("pharmerp_refresh_token", newRefresh);
      apiClient.defaults.headers["Authorization"] = `Bearer ${accessToken}`;
      processQueue(null, accessToken);
      return apiClient(original);
    } catch (err) {
      processQueue(err, null);
      localStorage.removeItem("pharmerp_access_token");
      localStorage.removeItem("pharmerp_refresh_token");
      window.location.href = "/login";
      return Promise.reject(err);
    } finally {
      isRefreshing = false;
    }
  },
);

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
