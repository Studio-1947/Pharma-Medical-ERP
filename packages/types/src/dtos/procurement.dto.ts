import { z } from "zod";

export const createSupplierSchema = z.object({
  name: z.string().min(1).max(255),
  code: z.string().min(1).max(50),
  contactPerson: z.string().max(255).optional(),
  phone: z.string().min(7).max(20),
  email: z.string().email().max(255).optional(),
  address: z.string().optional(),
  gstNo: z.string().max(20).optional(),
  panNo: z.string().max(20).optional(),
  creditDays: z.number().int().min(0).default(0),
  creditLimit: z.string().regex(/^\d+(\.\d{1,2})?$/).default("0"),
  rating: z.number().int().min(1).max(5).default(3),
});

export const updateSupplierSchema = createSupplierSchema.partial();

export const querySupplierSchema = z.object({
  search: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const createPurchaseOrderSchema = z.object({
  supplierId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  expectedDelivery: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().optional(),
  items: z.array(z.object({
    medicineId: z.string().uuid(),
    orderedQty: z.number().int().min(1),
    unitCost: z.string().regex(/^\d+(\.\d{1,2})?$/),
    taxPct: z.enum(["0", "5", "12", "18"]).optional().default("0"),
  })).min(1),
});

export const approvePurchaseOrderSchema = z.object({
  approved: z.boolean(),
  notes: z.string().optional(),
});

export const createGrnSchema = z.object({
  poId: z.string().uuid(),
  supplierInvoiceNo: z.string().max(100).optional(),
  qcPassed: z.boolean(),
  qcNotes: z.string().optional(),
  items: z.array(z.object({
    poItemId: z.string().uuid(),
    receivedQty: z.number().int().min(0),
    rejectedQty: z.number().int().min(0).default(0),
    batchNo: z.string().min(1).max(100),
    expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })).min(1),
});

export const queryPurchaseOrderSchema = z.object({
  supplierId: z.string().uuid().optional(),
  status: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateSupplierDto = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierDto = z.infer<typeof updateSupplierSchema>;
export type QuerySupplierDto = z.infer<typeof querySupplierSchema>;
export type CreatePurchaseOrderDto = z.infer<typeof createPurchaseOrderSchema>;
export type ApprovePurchaseOrderDto = z.infer<typeof approvePurchaseOrderSchema>;
export type CreateGrnDto = z.infer<typeof createGrnSchema>;
export type QueryPurchaseOrderDto = z.infer<typeof queryPurchaseOrderSchema>;
