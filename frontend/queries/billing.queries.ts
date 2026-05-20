"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, queryKeys } from "@/lib/api-client";

export function useInvoices(params: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: queryKeys.invoices.list(params),
    queryFn: () => apiClient.get("/billing/invoices", { params }) as Promise<any>,
  });
}

export function useInvoice(id: string) {
  return useQuery({
    queryKey: queryKeys.invoices.detail(id),
    queryFn: () => apiClient.get(`/billing/invoices/${id}`) as Promise<any>,
    enabled: !!id,
  });
}

export function useCreateInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: unknown) => apiClient.post("/billing/invoices", data) as Promise<any>,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.invoices.all() }),
  });
}

export function useVoidInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiClient.post(`/billing/invoices/${id}/void`, { reason }) as Promise<any>,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.invoices.all() }),
  });
}

export function useDailySummary(branchId?: string, date?: string) {
  return useQuery({
    queryKey: ["billing", "daily-summary", branchId, date],
    queryFn: () =>
      apiClient.get("/billing/reports/end-of-day", {
        params: { branchId, date },
      }) as Promise<any>,
    enabled: !!branchId,
  });
}
