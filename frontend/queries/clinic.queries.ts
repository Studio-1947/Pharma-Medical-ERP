"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, queryKeys } from "@/lib/api-client";

export function useClinicDoctors() {
  return useQuery({
    queryKey: queryKeys.clinicTokens.doctors(),
    queryFn: () => apiClient.get("/clinic/doctors") as Promise<any>,
  });
}

export function useClinicTokens(params: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: queryKeys.clinicTokens.list(params),
    queryFn: () => apiClient.get("/clinic/tokens", { params }) as Promise<any>,
    refetchInterval: 15000,
  });
}

export function useClinicToken(id: string) {
  return useQuery({
    queryKey: queryKeys.clinicTokens.detail(id),
    queryFn: () => apiClient.get(`/clinic/tokens/${id}`) as Promise<any>,
    enabled: !!id,
  });
}

export function useCreateClinicToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: unknown) => apiClient.post("/clinic/tokens", data) as Promise<any>,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.clinicTokens.all() }),
  });
}

export function useUpdateClinicToken(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: unknown) => apiClient.patch(`/clinic/tokens/${id}`, data) as Promise<any>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.clinicTokens.all() });
      qc.invalidateQueries({ queryKey: queryKeys.clinicTokens.detail(id) });
    },
  });
}
