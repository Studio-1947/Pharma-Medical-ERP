"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type {
  AbcAnalysisResponseDto,
  HourlySalesPatternResponseDto,
} from "@pharmerp/types";

export function useSalesReport(params: Record<string, unknown>) {
  return useQuery({
    queryKey: ["reports", "sales", params],
    queryFn: () => apiClient.get("/reports/sales", { params }) as Promise<{
      rows: Array<{ date: string; revenue: number; invoices: number }>;
    }>,
    enabled: !!params.branchId,
  });
}

export function useGstReport(params: { branchId: string; month: number; year: number }) {
  return useQuery({
    queryKey: ["reports", "gst", params],
    queryFn: () => apiClient.get("/reports/gst", { params }) as Promise<{
      data: Array<{
        invoiceNo: string;
        date: string;
        itemName: string;
        hsnCode: string;
        quantity: number;
        taxableAmount: number;
        cgstAmount: string;
        sgstAmount: string;
        igstAmount: string;
        totalAmount: string;
      }>;
    }>,
    enabled: !!params.branchId,
  });
}

export function useScheduleHReport(params: Record<string, unknown>) {
  return useQuery({
    queryKey: ["reports", "schedule-h", params],
    queryFn: () =>
      apiClient.get("/reports/schedule-h-register", { params }) as Promise<{
        data: Array<{
          date: string;
          invoiceNo: string;
          drugName: string;
          scheduleClass: string;
          batchNo: string;
          quantity: number;
          patientName: string;
          doctorName: string;
          doctorRegNo: string;
        }>;
      }>,
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

// ClickHouse-backed analytics

export function useAbcAnalysis(params: { branchId: string; days?: number }) {
  return useQuery({
    queryKey: ["reports", "abc-analysis", params],
    queryFn: () =>
      apiClient.get("/reports/abc-analysis", { params }) as Promise<AbcAnalysisResponseDto>,
    enabled: !!params.branchId,
    staleTime: 5 * 60 * 1000, // ABC data is expensive to compute — cache 5 min
  });
}

export function useHourlySalesPattern(params: { branchId: string; days?: number }) {
  return useQuery({
    queryKey: ["reports", "hourly-pattern", params],
    queryFn: () =>
      apiClient.get("/reports/hourly-pattern", { params }) as Promise<HourlySalesPatternResponseDto>,
    enabled: !!params.branchId,
    staleTime: 5 * 60 * 1000,
  });
}
