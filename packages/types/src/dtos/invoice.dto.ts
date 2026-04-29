import { z } from "zod";

export const invoiceItemSchema = z.object({
  medicineId: z.string().uuid(),
  batchId: z.string().uuid(),
  quantity: z.number().int().min(1),
  unitPrice: z.string().regex(/^\d+(\.\d{1,2})?$/),
  discountPct: z.string().regex(/^\d+(\.\d{1,2})?$/).default("0"),
  taxPct: z.string().regex(/^\d+(\.\d{1,2})?$/).default("0"),
});

export const createInvoiceSchema = z.object({
  patientId: z.string().uuid().optional(),
  prescriptionId: z.string().uuid().optional(),
  branchId: z.string().uuid(),
  paymentMode: z.enum(["cash", "card", "upi", "insurance", "credit", "mixed"]).default("cash"),
  discountAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).default("0"),
  notes: z.string().optional(),
  isOfflineSync: z.boolean().default(false),
  items: z.array(invoiceItemSchema).min(1),
});

export const queryInvoiceSchema = z.object({
  patientId: z.string().uuid().optional(),
  staffId: z.string().uuid().optional(),
  status: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const voidInvoiceSchema = z.object({
  reason: z.string().min(1),
});

export type InvoiceItemDto = z.infer<typeof invoiceItemSchema>;
export type CreateInvoiceDto = z.infer<typeof createInvoiceSchema>;
export type QueryInvoiceDto = z.infer<typeof queryInvoiceSchema>;
export type VoidInvoiceDto = z.infer<typeof voidInvoiceSchema>;
