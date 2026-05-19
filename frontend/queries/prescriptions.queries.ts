"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, queryKeys } from "@/lib/api-client";

export function usePrescriptions(params: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: queryKeys.prescriptions.list(params),
    queryFn: () => apiClient.get("/prescriptions", { params }) as Promise<any>,
  });
}

export function usePrescription(id: string) {
  return useQuery({
    queryKey: queryKeys.prescriptions.detail(id),
    queryFn: () => apiClient.get(`/prescriptions/${id}`) as Promise<any>,
    enabled: !!id,
  });
}

export function useCreatePrescription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: unknown) =>
      apiClient.post("/prescriptions", data) as Promise<any>,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.prescriptions.all() }),
  });
}

export function useVerifyPrescription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.patch(`/prescriptions/${id}/verify`, {}) as Promise<any>,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.prescriptions.all() }),
  });
}
