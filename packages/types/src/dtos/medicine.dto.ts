import { z } from "zod";

// Duplicated from @pharmerp/utils (isValidEAN13) — types is the bottom-level
// package and cannot depend on utils.
function isValidEan13Checksum(code: string): boolean {
  const digits = code.split("").map(Number);
  const check = digits[12]!;
  const sum = digits.slice(0, 12).reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === check;
}

// Only 13-digit codes are checksum-validated; other formats (Code-128, UPC-A,
// internal SKU-style codes) pass through untouched.
const barcodeSchema = z
  .string()
  .max(100)
  .refine((v) => !/^\d{13}$/.test(v) || isValidEan13Checksum(v), {
    message: "Invalid EAN-13 barcode: checksum digit does not match",
  });

export const createMedicineSchema = z.object({
  name: z.string().min(1).max(255),
  genericName: z.string().max(255).optional(),
  sku: z.string().min(1).max(100),
  barcode: barcodeSchema.optional(),
  categoryId: z.string().uuid().optional(),
  manufacturer: z.string().max(255).optional(),
  hsnCode: z.string().max(20).optional(),
  unit: z.string().max(50).default("strip"),
  stripSize: z.number().int().min(1).default(1),
  priceMrp: z.string().regex(/^\d+(\.\d{1,2})?$/, "Must be a valid decimal"),
  taxPercent: z.string().regex(/^\d+(\.\d{1,2})?$/).default("0"),
  reorderLevel: z.number().int().min(0).default(10),
  reorderQty: z.number().int().min(0).default(50),
  requiresPrescription: z.boolean().default(false),
  isControlled: z.boolean().default(false),
  scheduleClass: z.string().max(10).optional(),
  storageConditions: z.string().max(100).optional(),
  description: z.string().optional(),
});

export const updateMedicineSchema = createMedicineSchema.partial().omit({});

export const queryMedicineSchema = z.object({
  search: z.string().optional(),
  categoryId: z.string().uuid().optional(),
  isActive: z.coerce.boolean().optional(),
  requiresPrescription: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateMedicineDto = z.infer<typeof createMedicineSchema>;
export type UpdateMedicineDto = z.infer<typeof updateMedicineSchema>;
export type QueryMedicineDto = z.infer<typeof queryMedicineSchema>;
