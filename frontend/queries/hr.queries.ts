"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, queryKeys } from "@/lib/api-client";

export function useEmployees(params: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: queryKeys.employees.list(params),
    queryFn: () => apiClient.get("/hr/employees", { params }) as Promise<any>,
  });
}

export function useEmployee(id: string) {
  return useQuery({
    queryKey: queryKeys.employees.detail(id),
    queryFn: () => apiClient.get(`/hr/employees/${id}`) as Promise<any>,
    enabled: !!id,
  });
}

export function useCreateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: unknown) =>
      apiClient.post("/hr/employees", data) as Promise<any>,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.employees.all() }),
  });
}

export function useUpdateEmployee(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: unknown) =>
      apiClient.patch(`/hr/employees/${id}`, data) as Promise<any>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.employees.all() });
      qc.invalidateQueries({ queryKey: queryKeys.employees.detail(id) });
    },
  });
}

export function useLeaves(params: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: ["hr", "leaves", params],
    queryFn: () => apiClient.get("/hr/leaves", { params }) as Promise<any>,
  });
}

export function useApproveLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiClient.patch(`/hr/leaves/${id}/status`, { status }) as Promise<any>,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hr", "leaves"] }),
  });
}
