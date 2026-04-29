import { z } from "zod";

export const createMedicineSchema = z.object({
  name: z.string().min(1).max(255),
  genericName: z.string().max(255).optional(),
  sku: z.string().min(1).max(100),
  barcode: z.string().max(100).optional(),
  categoryId: z.string().uuid().optional(),
  manufacturer: z.string().max(255).optional(),
  hsnCode: z.string().max(20).optional(),
  unit: z.string().max(50).default("strip"),
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
