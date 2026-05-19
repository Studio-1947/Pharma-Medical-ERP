"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, queryKeys } from "@/lib/api-client";

export function useMedicines(params: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: queryKeys.medicines.list(params),
    queryFn: () => apiClient.get("/medicines", { params }) as Promise<any>,
  });
}

export function useMedicine(id: string) {
  return useQuery({
    queryKey: queryKeys.medicines.detail(id),
    queryFn: () => apiClient.get(`/medicines/${id}`) as Promise<any>,
    enabled: !!id,
  });
}

export function useMedicineBatches(id: string) {
  return useQuery({
    queryKey: queryKeys.medicines.batches(id),
    queryFn: () => apiClient.get(`/medicines/${id}/batches`) as Promise<any>,
    enabled: !!id,
  });
}

export function useCreateMedicine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: unknown) => apiClient.post("/medicines", data) as Promise<any>,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.medicines.all() }),
  });
}

export function useUpdateMedicine(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: unknown) => apiClient.patch(`/medicines/${id}`, data) as Promise<any>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.medicines.all() });
      qc.invalidateQueries({ queryKey: queryKeys.medicines.detail(id) });
    },
  });
}

export function useDeleteMedicine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/medicines/${id}`) as Promise<any>,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.medicines.all() }),
  });
}
