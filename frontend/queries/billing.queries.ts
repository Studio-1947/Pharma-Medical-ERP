"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, queryKeys } from "@/lib/api-client";
import type {
  InvoiceListResponseDto,
  InvoiceResponseDto,
  EndOfDaySummaryDto,
  PdfUrlResponseDto,
  QueryInvoiceDto,
  CreateInvoiceDto,
  VoidInvoiceDto,
  ReturnInvoiceDto,
  RecordPaymentDto,
} from "@pharmerp/types";

export function useInvoices(params: Partial<QueryInvoiceDto> = {}) {
  return useQuery({
    queryKey: queryKeys.invoices.list(params),
    queryFn: () =>
      apiClient.get("/billing/invoices", { params }) as Promise<InvoiceListResponseDto>,
  });
}

export function useInvoice(id: string) {
  return useQuery({
    queryKey: queryKeys.invoices.detail(id),
    queryFn: () =>
      apiClient.get(`/billing/invoices/${id}`) as Promise<{ data: InvoiceResponseDto }>,
    enabled: !!id,
  });
}

export function useCreateInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateInvoiceDto) =>
      apiClient.post("/billing/invoices", data) as Promise<{
        invoice: InvoiceResponseDto;
        items: InvoiceResponseDto["items"];
      }>,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.invoices.all() }),
  });
}

export function useVoidInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & VoidInvoiceDto) =>
      apiClient.post(`/billing/invoices/${id}/void`, body) as Promise<{ message: string }>,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.invoices.all() }),
  });
}

export function useReturnInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & ReturnInvoiceDto) =>
      apiClient.post(`/billing/invoices/${id}/return`, body) as Promise<{
        data: { invoice: InvoiceResponseDto; items: InvoiceResponseDto["items"] };
        message: string;
      }>,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.invoices.all() }),
  });
}

export function useRecordPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: RecordPaymentDto) =>
      apiClient.post("/billing/payments", data) as Promise<{ data: unknown; message: string }>,
    onSuccess: (_res, vars) =>
      qc.invalidateQueries({ queryKey: queryKeys.invoices.detail(vars.invoiceId) }),
  });
}

export function useInvoicePdf(id: string, enabled = false) {
  return useQuery({
    queryKey: ["billing", "pdf", id],
    queryFn: () =>
      apiClient.get(`/billing/invoices/${id}/pdf`) as Promise<PdfUrlResponseDto>,
    enabled: !!id && enabled,
    refetchInterval: (query) => {
      // Keep polling every 3s until the PDF is ready
      const data = query.state.data as PdfUrlResponseDto | undefined;
      return data?.ready === false ? 3000 : false;
    },
  });
}

export function useDailySummary(branchId?: string, date?: string) {
  return useQuery({
    queryKey: ["billing", "daily-summary", branchId, date],
    queryFn: () =>
      apiClient.get("/billing/reports/end-of-day", {
        params: { branchId, date },
      }) as Promise<{ data: EndOfDaySummaryDto }>,
    enabled: !!branchId,
  });
}
