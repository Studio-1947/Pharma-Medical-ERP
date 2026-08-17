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
// A blank/whitespace barcode is normalized to undefined so it stores as NULL
// (not ""), keeping the barcode column clean for the unique index.
// `.optional()` must live INSIDE the preprocess: a blank barcode is turned into
// undefined here, so the inner schema has to accept undefined or it 400s.
const barcodeSchema = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z
    .string()
    .max(100)
    .refine((v) => !/^\d{13}$/.test(v) || isValidEan13Checksum(v), {
      message: "Invalid EAN-13 barcode: checksum digit does not match",
    })
    .optional(),
);

const decimalString = /^\d+(\.\d{1,2})?$/;

export const createMedicineSchema = z.object({
  name: z.string().min(1).max(255),
  brandName: z.string().max(255).optional(),
  // No .max(): backed by a text column — combination products run past 350 chars.
  genericName: z.string().optional(),
  composition: z.string().optional(),
  strength: z.string().optional(),
  dosageForm: z.string().max(50).optional(),
  packSize: z.string().max(50).optional(),
  // Optional on input — when left blank the backend mints a sequential
  // MEDNNNNN id. Manual entry is still accepted for imports and legacy stock
  // that carries a supplier / GS1 code the shop wants preserved.
  sku: z.string().max(100).optional(),
  barcode: barcodeSchema,
  categoryId: z.string().uuid().optional(),
  therapeuticClass: z.string().max(100).optional(),
  manufacturer: z.string().max(255).optional(),
  hsnCode: z.string().max(20).optional(),
  unit: z.string().max(50).default("strip"),
  stripSize: z.number().int().min(1).default(1),
  priceMrp: z.string().regex(decimalString, "Must be a valid decimal"),
  purchaseRate: z.string().regex(decimalString, "Must be a valid decimal").optional(),
  taxPercent: z.string().regex(decimalString).default("0"),
  reorderLevel: z.number().int().min(0).default(10),
  reorderQty: z.number().int().min(0).default(50),
  requiresPrescription: z.boolean().default(false),
  isControlled: z.boolean().default(false),
  scheduleClass: z.string().max(10).optional(),
  storageConditions: z.string().max(100).optional(),
  drawerMapping: z.string().max(50).optional(),
  description: z.string().optional(),
  // Bulk import parks incompletely-specified products here (no MRP yet) so the
  // catalogue is complete without them being sellable.
  isActive: z.boolean().default(true),
});

export const updateMedicineSchema = createMedicineSchema.partial().omit({});

export const queryMedicineSchema = z.object({
  search: z.string().optional(),
  categoryId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  isActive: z.coerce.boolean().optional(),
  requiresPrescription: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(1000).default(20),
});

export type CreateMedicineDto = z.infer<typeof createMedicineSchema>;
export type UpdateMedicineDto = z.infer<typeof updateMedicineSchema>;
export type QueryMedicineDto = z.infer<typeof queryMedicineSchema>;
