import { z } from "zod";

export const createBatchSchema = z.object({
  medicineId: z.string().uuid(),
  locationId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  batchNo: z.string().min(1).max(100),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
  quantity: z.number().int().min(1),
  costPrice: z.string().regex(/^\d+(\.\d{1,2})?$/),
  mrpAtEntry: z.string().regex(/^\d+(\.\d{1,2})?$/),
  poId: z.string().uuid().optional(),
  grnId: z.string().uuid().optional(),
});

export const updateBatchSchema = z.object({
  batchNo: z.string().min(1).max(100).optional(),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD").optional(),
  costPrice: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  mrpAtEntry: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  status: z.enum(["active", "quarantine", "expired", "depleted", "recalled"]).optional(),
});

export const updateBatchStatusSchema = z.object({
  status: z.enum(["active", "quarantine", "expired", "depleted", "recalled"]),
  notes: z.string().optional(),
});

export const adjustBatchQuantitySchema = z.object({
  adjustment: z.number().int(), // positive = add, negative = remove
  notes: z.string().min(1, "Notes required for adjustments"),
});

export const queryBatchSchema = z.object({
  medicineId: z.string().uuid().optional(),
  status: z.string().optional(),
  expiringBefore: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const reserveBatchStockSchema = z.object({
  quantity: z.number().int().min(1),
});

export const releaseBatchStockSchema = z.object({
  quantity: z.number().int().min(1),
});

/**
 * OTC supply — a medicine handed over from the counter WITHOUT an invoice.
 * Stock is decremented and a ledger movement is recorded so the supply stays
 * traceable, but no bill is generated. Common to the counter desk and the
 * classic POS.
 */
export const otcSupplyBatchSchema = z.object({
  quantity: z.number().int().min(1),
  branchId: z.string().uuid().optional(),
  notes: z.string().max(300).optional(),
});

export type CreateBatchDto = z.infer<typeof createBatchSchema>;
export type UpdateBatchDto = z.infer<typeof updateBatchSchema>;
export type UpdateBatchStatusDto = z.infer<typeof updateBatchStatusSchema>;
export type AdjustBatchQuantityDto = z.infer<typeof adjustBatchQuantitySchema>;
export type QueryBatchDto = z.infer<typeof queryBatchSchema>;
export type ReserveBatchStockDto = z.infer<typeof reserveBatchStockSchema>;
export type OtcSupplyBatchDto = z.infer<typeof otcSupplyBatchSchema>;
export type ReleaseBatchStockDto = z.infer<typeof releaseBatchStockSchema>;
