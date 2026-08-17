"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, queryKeys } from "@/lib/api-client";

export function useClinicDoctors(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.clinicTokens.doctors(),
    queryFn: () => apiClient.get("/clinic/doctors") as Promise<any>,
    // Pharmacists are not on this route's @Roles list, so callers that render
    // for every role must gate the request rather than eat a 403.
    enabled: options.enabled ?? true,
  });
}

export function useClinicTokens(
  params: Record<string, unknown> = {},
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: queryKeys.clinicTokens.list(params),
    queryFn: () => apiClient.get("/clinic/tokens", { params }) as Promise<any>,
    refetchInterval: 15000,
    enabled: options.enabled ?? true,
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

// ── Doctor medicine list ─────────────────────────────────────────────────────

/**
 * Medicines a doctor keeps on their list, with stock for the active branch.
 *
 * `branchId` only changes the stock number on each row — the list itself
 * belongs to the doctor — so a medicine the branch has none of still appears,
 * showing zero. That is deliberate: the counter needs to see that the doctor
 * works with it and that it needs ordering.
 */
export function useDoctorMedicines(
  doctorId: string | null,
  branchId?: string,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: queryKeys.clinicTokens.doctorMedicines(doctorId ?? "", branchId),
    queryFn: () =>
      apiClient.get(`/clinic/doctors/${doctorId}/medicines`, {
        params: branchId ? { branchId } : undefined,
      }) as Promise<any>,
    enabled: !!doctorId && (options.enabled ?? true),
  });
}

export function useAddDoctorMedicine(doctorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: unknown) =>
      apiClient.post(`/clinic/doctors/${doctorId}/medicines`, data) as Promise<any>,
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: queryKeys.clinicTokens.doctorMedicinesAll(doctorId),
      }),
  });
}

export function useUpdateDoctorMedicine(doctorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, ...data }: { itemId: string } & Record<string, unknown>) =>
      apiClient.patch(
        `/clinic/doctors/${doctorId}/medicines/${itemId}`,
        data,
      ) as Promise<any>,
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: queryKeys.clinicTokens.doctorMedicinesAll(doctorId),
      }),
  });
}

export function useRemoveDoctorMedicine(doctorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) =>
      apiClient.delete(
        `/clinic/doctors/${doctorId}/medicines/${itemId}`,
      ) as Promise<any>,
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: queryKeys.clinicTokens.doctorMedicinesAll(doctorId),
      }),
  });
}

/** Seeds an empty list from the doctor's own prescription history. */
export function useImportDoctorMedicines(doctorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (limit: number = 20) =>
      apiClient.post(
        `/clinic/doctors/${doctorId}/medicines/import-from-history?limit=${limit}`,
        {},
      ) as Promise<any>,
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: queryKeys.clinicTokens.doctorMedicinesAll(doctorId),
      }),
  });
}
