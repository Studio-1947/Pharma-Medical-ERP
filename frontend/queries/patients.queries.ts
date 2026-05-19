"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, queryKeys } from "@/lib/api-client";

export function usePatients(params: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: queryKeys.patients.list(params),
    queryFn: () => apiClient.get("/patients", { params }) as Promise<any>,
  });
}

export function usePatient(id: string) {
  return useQuery({
    queryKey: queryKeys.patients.detail(id),
    queryFn: () => apiClient.get(`/patients/${id}`) as Promise<any>,
    enabled: !!id,
  });
}

export function useCreatePatient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: unknown) => apiClient.post("/patients", data) as Promise<any>,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.patients.all() }),
  });
}

export function useUpdatePatient(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: unknown) => apiClient.patch(`/patients/${id}`, data) as Promise<any>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.patients.all() });
      qc.invalidateQueries({ queryKey: queryKeys.patients.detail(id) });
    },
  });
}
