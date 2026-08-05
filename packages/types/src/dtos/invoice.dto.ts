import { z } from "zod";

export const invoiceItemSchema = z.object({
  medicineId: z.string().uuid(),
  quantity: z.number().int().min(1),
  discountPct: z.string().regex(/^\d+(\.\d{1,2})?$/).default("0"),
  // batchId REMOVED — server performs FEFO (BILL-06)
  // unitPrice REMOVED — server reads mrpAtEntry from batch (BILL-07)
  // taxPct REMOVED — server reads medicine.taxPercent from DB
});

export const paymentEntrySchema = z.object({
  mode: z.enum(["cash", "card", "upi", "insurance", "credit", "mixed"]),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  referenceNo: z.string().max(100).optional(),
});

export const createInvoiceSchema = z.object({
  patientId: z.string().uuid().optional(),
  prescriptionId: z.string().uuid().optional(),
  // Honoured only for super_admin, who has no branch of their own; every other
  // role is pinned to its own branch server-side regardless of what is sent.
  branchId: z.string().uuid().optional(),
  discountAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).default("0"),
  loyaltyPointsToRedeem: z.number().int().min(0).default(0),
  notes: z.string().optional(),
  isOfflineSync: z.boolean().default(false),
  items: z.array(invoiceItemSchema).min(1),
  payments: z.array(paymentEntrySchema).min(1),
  overrideReason: z.string().min(1).optional(),
  overriddenBy: z.string().uuid().optional(),
});

export const returnItemSchema = z.object({
  invoiceItemId: z.string().uuid(),
  returnQty: z.number().int().min(1),
});

export const returnInvoiceSchema = z.object({
  items: z.array(returnItemSchema).min(1),
  reason: z.string().min(1),
});

export const queryInvoiceSchema = z.object({
  patientId: z.string().uuid().optional(),
  staffId: z.string().uuid().optional(),
  status: z.string().optional(),
  search: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const voidInvoiceSchema = z.object({
  reason: z.string().min(1),
});

export type InvoiceItemDto = z.infer<typeof invoiceItemSchema>;
export type PaymentEntryDto = z.infer<typeof paymentEntrySchema>;
export type CreateInvoiceDto = z.infer<typeof createInvoiceSchema>;
export type ReturnItemDto = z.infer<typeof returnItemSchema>;
export type ReturnInvoiceDto = z.infer<typeof returnInvoiceSchema>;
export type QueryInvoiceDto = z.infer<typeof queryInvoiceSchema>;
export type VoidInvoiceDto = z.infer<typeof voidInvoiceSchema>;
