import { z } from "zod";

// A blank/whitespace value from a form input is treated as "not provided" so
// optional fields store as NULL and don't trip format validation (e.g. an empty
// email string must not fail `.email()`). Trims incoming values too.
function optionalField<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : v.trim()) : v),
    schema.optional(),
  );
}

// Indian GSTIN: 15 chars — 2 state digits, 5 PAN letters, 4 digits, 1 letter,
// 1 entity digit/letter, 'Z', 1 checksum char.
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
// Indian PAN: 5 letters, 4 digits, 1 letter.
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const createSupplierSchema = z.object({
  name: z.string().min(1).max(255),
  code: z.string().min(1).max(50),
  contactPerson: optionalField(z.string().max(255)),
  phone: z.string().min(7).max(20).regex(/^[0-9+\-\s()]{7,20}$/, "Enter a valid phone number"),
  email: optionalField(z.string().email("Enter a valid email address").max(255)),
  address: optionalField(z.string().max(500)),
  gstNo: optionalField(z.string().toUpperCase().regex(GSTIN_RE, "Invalid GSTIN (15-char format)")),
  panNo: optionalField(z.string().toUpperCase().regex(PAN_RE, "Invalid PAN (e.g. ABCDE1234F)")),
  drugLicenseNo: optionalField(z.string().max(50)),
  drugLicenseExpiry: optionalField(z.string().regex(DATE_RE, "Use YYYY-MM-DD")),
  creditDays: z.number().int().min(0).max(365).default(0),
  creditLimit: z.string().regex(/^\d+(\.\d{1,2})?$/, "Must be a valid amount").default("0"),
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
