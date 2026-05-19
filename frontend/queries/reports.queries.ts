"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

export function useSalesReport(params: Record<string, unknown>) {
  return useQuery({
    queryKey: ["reports", "sales", params],
    queryFn: () => apiClient.get("/reports/sales", { params }) as Promise<any>,
    enabled: !!params.branchId,
  });
}

export function useGstReport(params: { branchId: string; month: number; year: number }) {
  return useQuery({
    queryKey: ["reports", "gst", params],
    queryFn: () => apiClient.get("/reports/gst", { params }) as Promise<any>,
    enabled: !!params.branchId,
  });
}

export function useScheduleHReport(params: Record<string, unknown>) {
  return useQuery({
    queryKey: ["reports", "schedule-h", params],
    queryFn: () =>
      apiClient.get("/reports/schedule-h-register", { params }) as Promise<any>,
    enabled: !!params.branchId,
  });
}

export function useExpiryReport(params: { branchId: string; days: number }) {
  return useQuery({
    queryKey: ["reports", "expiry", params],
    queryFn: () =>
      apiClient.get("/reports/expiry", { params }) as Promise<any>,
    enabled: !!params.branchId,
  });
}
