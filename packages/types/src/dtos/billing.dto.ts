import { z } from "zod";

// ---------------------------------------------------------------------------
// Request schemas (standalone payment recording against an existing invoice)
// ---------------------------------------------------------------------------

export const recordPaymentSchema = z.object({
  invoiceId: z.string().uuid(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  mode: z.enum(["cash", "card", "upi", "insurance", "credit", "mixed"]),
  referenceNo: z.string().max(100).optional(),
});

export type RecordPaymentDto = z.infer<typeof recordPaymentSchema>;

// ---------------------------------------------------------------------------
// Response schemas
// ---------------------------------------------------------------------------

export const paymentResponseSchema = z.object({
  id: z.string().uuid(),
  invoiceId: z.string().uuid(),
  amount: z.string(),
  mode: z.enum(["cash", "card", "upi", "insurance", "credit", "mixed"]),
  referenceNo: z.string().nullable().optional(),
  processedBy: z.string().uuid(),
  createdAt: z.string(),
});

export type PaymentResponseDto = z.infer<typeof paymentResponseSchema>;

export const invoiceItemResponseSchema = z.object({
  id: z.string().uuid(),
  invoiceId: z.string().uuid(),
  medicineId: z.string().uuid(),
  batchId: z.string().uuid(),
  quantity: z.number().int(),
  unitPrice: z.string(),
  discountPct: z.string(),
  taxPct: z.string(),
  lineTotal: z.string(),
  cgstAmt: z.string(),
  sgstAmt: z.string(),
  igstAmt: z.string(),
  medicine: z
    .object({
      id: z.string().uuid(),
      name: z.string(),
      genericName: z.string().nullable().optional(),
      scheduleClass: z.string().nullable().optional(),
    })
    .optional(),
});

export type InvoiceItemResponseDto = z.infer<typeof invoiceItemResponseSchema>;

export const patientSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  phone: z.string(),
  email: z.string().nullable().optional(),
  loyaltyPoints: z.number().int(),
});

export type PatientSummaryDto = z.infer<typeof patientSummarySchema>;

export const invoiceResponseSchema = z.object({
  id: z.string().uuid(),
  invoiceNo: z.string(),
  patientId: z.string().uuid().nullable().optional(),
  staffId: z.string().uuid(),
  branchId: z.string().uuid().nullable().optional(),
  prescriptionId: z.string().uuid().nullable().optional(),
  subtotal: z.string(),
  discountAmount: z.string(),
  taxAmount: z.string(),
  totalAmount: z.string(),
  amountPaid: z.string(),
  amountDue: z.string(),
  paymentMode: z.enum(["cash", "card", "upi", "insurance", "credit", "mixed"]),
  status: z.enum(["draft", "confirmed", "cancelled"]),
  notes: z.string().nullable().optional(),
  isOfflineSync: z.boolean(),
  isReturn: z.boolean(),
  originalInvoiceId: z.string().uuid().nullable().optional(),
  overrideReason: z.string().nullable().optional(),
  overriddenBy: z.string().uuid().nullable().optional(),
  customerGstin: z.string().nullable().optional(),
  pdfUrl: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  patient: patientSummarySchema.nullable().optional(),
  items: z.array(invoiceItemResponseSchema).optional(),
  payments: z.array(paymentResponseSchema).optional(),
});

export type InvoiceResponseDto = z.infer<typeof invoiceResponseSchema>;

export const invoiceListResponseSchema = z.object({
  data: z.array(invoiceResponseSchema),
  meta: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  }),
});

export type InvoiceListResponseDto = z.infer<typeof invoiceListResponseSchema>;

export const endOfDaySummarySchema = z.object({
  totalInvoices: z.number().int(),
  totalSales: z.number(),
  totalTax: z.number(),
  totalDiscounts: z.number(),
});

export type EndOfDaySummaryDto = z.infer<typeof endOfDaySummarySchema>;

export const pdfUrlResponseSchema = z.object({
  ready: z.boolean(),
  url: z.string().optional(),
  message: z.string().optional(),
});

export type PdfUrlResponseDto = z.infer<typeof pdfUrlResponseSchema>;
