"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, queryKeys } from "@/lib/api-client";

export function useSuppliers(params: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: queryKeys.suppliers.list(params),
    queryFn: () => apiClient.get("/procurement/suppliers", { params }) as Promise<any>,
  });
}

export function useSupplier(id: string) {
  return useQuery({
    queryKey: queryKeys.suppliers.detail(id),
    queryFn: () => apiClient.get(`/procurement/suppliers/${id}`) as Promise<any>,
    enabled: !!id,
  });
}

export function useCreateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: unknown) =>
      apiClient.post("/procurement/suppliers", data) as Promise<any>,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.suppliers.all() }),
  });
}

export function usePurchaseOrders(params: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: queryKeys.purchaseOrders.list(params),
    queryFn: () =>
      apiClient.get("/procurement/purchase-orders", { params }) as Promise<any>,
  });
}

export function usePurchaseOrder(id: string) {
  return useQuery({
    queryKey: queryKeys.purchaseOrders.detail(id),
    queryFn: () =>
      apiClient.get(`/procurement/purchase-orders/${id}`) as Promise<any>,
    enabled: !!id,
  });
}

export function useCreatePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: unknown) =>
      apiClient.post("/procurement/purchase-orders", data) as Promise<any>,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all() }),
  });
}

export function useReceivePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: unknown }) =>
      apiClient.post(`/procurement/purchase-orders/${id}/receive`, data) as Promise<any>,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all() }),
  });
}
