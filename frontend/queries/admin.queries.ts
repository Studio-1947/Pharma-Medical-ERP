"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, queryKeys } from "@/lib/api-client";

/**
 * Hooks for the super_admin developer console.
 *
 * Every apiClient call is cast to Promise<any>: axios types claim an
 * AxiosResponse, but the response interceptor returns res.data, so the
 * declared type is wrong at runtime.
 *
 * User and branch operations deliberately hit the existing /users and
 * /branches endpoints rather than an /admin mirror — super_admin already
 * passes RolesGuard on both, so a second surface would only be a second thing
 * to secure.
 */

// ------------------------------------------------------------------ reads

export function useAdminOverview() {
  return useQuery({
    queryKey: queryKeys.admin.overview(),
    queryFn: () => apiClient.get("/admin/overview") as Promise<any>,
  });
}

export function useAuditLogs(params: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: queryKeys.admin.auditLogs(params),
    queryFn: () =>
      apiClient.get("/admin/audit-logs", { params }) as Promise<any>,
  });
}

export function useAuditActions() {
  return useQuery({
    queryKey: queryKeys.admin.auditActions(),
    queryFn: () => apiClient.get("/admin/audit-logs/actions") as Promise<any>,
    staleTime: 5 * 60 * 1000,
  });
}

export function useAdminSessions(params: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: queryKeys.admin.sessions(params),
    queryFn: () => apiClient.get("/admin/sessions", { params }) as Promise<any>,
  });
}

export function useAdminUsers(params: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: queryKeys.users.list(params),
    queryFn: () => apiClient.get("/users", { params }) as Promise<any>,
  });
}

export function useBranches() {
  return useQuery({
    queryKey: queryKeys.branches.all(),
    queryFn: () => apiClient.get("/branches") as Promise<any>,
    staleTime: 5 * 60 * 1000,
  });
}

// ------------------------------------------------------------- user writes

/**
 * Invalidates both key trees so the console and the older Settings screen
 * cannot show different answers for the same user.
 */
function invalidateUsers(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: queryKeys.users.all() });
  qc.invalidateQueries({ queryKey: queryKeys.admin.all() });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: unknown) =>
      apiClient.post("/users/invite", data) as Promise<any>,
    onSuccess: () => invalidateUsers(qc),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: unknown }) =>
      apiClient.patch(`/users/${id}`, data) as Promise<any>,
    onSuccess: () => invalidateUsers(qc),
  });
}

export function useChangeUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) =>
      apiClient.patch(`/users/${id}/role`, { role }) as Promise<any>,
    onSuccess: () => invalidateUsers(qc),
  });
}

export function useDeactivateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.patch(`/users/${id}/deactivate`, {}) as Promise<any>,
    onSuccess: () => invalidateUsers(qc),
  });
}

export function useReactivateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.patch(`/users/${id}/reactivate`, {}) as Promise<any>,
    onSuccess: () => invalidateUsers(qc),
  });
}

// -------------------------------------------------- privileged operations

export function useSetUserPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: unknown }) =>
      apiClient.post(`/admin/users/${id}/password`, data) as Promise<any>,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.admin.all() }),
  });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      apiClient.post(`/admin/sessions/${sessionId}/revoke`, {}) as Promise<any>,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.admin.all() }),
  });
}

export function useRevokeAllSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      apiClient.post(`/admin/users/${userId}/revoke-sessions`, {}) as Promise<any>,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.admin.all() }),
  });
}

export function useStartImpersonation() {
  return useMutation({
    mutationFn: ({ userId, data }: { userId: string; data: unknown }) =>
      apiClient.post(`/admin/impersonate/${userId}`, data) as Promise<any>,
  });
}

// ------------------------------------------------------------- normalisers

/**
 * Pulls the row array out regardless of how many envelopes it arrived in.
 *
 * There are two unwrap layers — the axios interceptor returns res.data, and
 * the server's TransformInterceptor wraps payloads as { success, data, meta }
 * while also spreading them — so the depth varies by endpoint.
 */
export function rowsOf<T>(raw: unknown): T[] {
  const d = raw as any;
  if (Array.isArray(d)) return d;
  if (Array.isArray(d?.data)) return d.data;
  if (Array.isArray(d?.data?.data)) return d.data.data;
  if (Array.isArray(d?.rows)) return d.rows;
  return [];
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function metaOf(raw: unknown): PageMeta | null {
  const d = raw as any;
  return d?.meta ?? d?.data?.meta ?? null;
}

/** Server error message, including Zod field errors, in a form fit to display. */
export function extractError(err: any, fallback: string): string {
  const data = err?.response?.data;
  if (!data) return err?.message ?? fallback;
  if (typeof data.message === "string") return data.message;
  if (Array.isArray(data.message)) return data.message.join(", ");
  if (data.errors && typeof data.errors === "object") {
    const parts = Object.entries(data.errors).map(
      ([field, msgs]) =>
        `${field}: ${Array.isArray(msgs) ? msgs.join(", ") : String(msgs)}`,
    );
    if (parts.length) return parts.join(" · ");
  }
  return fallback;
}
