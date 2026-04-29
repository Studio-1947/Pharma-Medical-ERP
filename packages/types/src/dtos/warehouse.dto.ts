import { z } from "zod";

export const createWarehouseSchema = z.object({
  branchId: z.string().uuid(),
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(20),
  address: z.string().optional(),
  isDefault: z.boolean().default(false),
});

export const updateWarehouseSchema = createWarehouseSchema
  .partial()
  .omit({ branchId: true });

export const createLocationSchema = z.object({
  warehouseId: z.string().uuid(),
  aisle: z.string().max(10).optional(),
  shelf: z.string().max(10).optional(),
  bin: z.string().max(10).optional(),
  label: z.string().min(1).max(50),
  isRefrigerated: z.boolean().default(false),
});

export type CreateWarehouseDto = z.infer<typeof createWarehouseSchema>;
export type UpdateWarehouseDto = z.infer<typeof updateWarehouseSchema>;
export type CreateLocationDto = z.infer<typeof createLocationSchema>;
