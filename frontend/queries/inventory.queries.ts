"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

export function useInventoryStock(params: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: ["inventory", "stock", params],
    queryFn: () => apiClient.get("/inventory/stock", { params }) as Promise<any>,
  });
}

export function useLowStockAlerts(branchId?: string) {
  return useQuery({
    queryKey: ["inventory", "low-stock", branchId],
    queryFn: () =>
      apiClient.get("/inventory/low-stock", { params: { branchId } }) as Promise<any>,
    enabled: !!branchId,
  });
}

export function useNearExpiryBatches(branchId?: string, days = 30) {
  return useQuery({
    queryKey: ["inventory", "near-expiry", branchId, days],
    queryFn: () =>
      apiClient.get("/inventory/near-expiry", {
        params: { branchId, days },
      }) as Promise<any>,
    enabled: !!branchId,
  });
}

export function useAdjustStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: unknown) =>
      apiClient.post("/inventory/adjust", data) as Promise<any>,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory"] }),
  });
}
