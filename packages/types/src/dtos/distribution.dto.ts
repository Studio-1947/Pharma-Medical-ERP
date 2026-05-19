import { z } from "zod";

export const createTransferItemSchema = z.object({
  medicineId: z.string().uuid("Invalid medicine ID"),
  requestedQty: z.number().int().min(1, "Quantity must be at least 1"),
  batchId: z.string().uuid("Batch ID is required"),
  notes: z.string().optional(),
});

export const createTransferSchema = z.object({
  fromWarehouseId: z.string().uuid("Invalid source warehouse ID"),
  toWarehouseId: z.string().uuid("Invalid destination warehouse ID"),
  notes: z.string().max(1000).optional(),
  items: z.array(createTransferItemSchema).min(1, "At least one item is required"),
});

export const deliverTransferItemSchema = z.object({
  itemId: z.string().uuid(),
  receivedQty: z.number().int().min(0),
  rejectedQty: z.number().int().min(0).optional(),
});

export const deliverTransferSchema = z.object({
  items: z.array(deliverTransferItemSchema),
});

export const queryTransferSchema = z.object({
  status: z
    .enum(["draft", "in_transit", "delivered", "rejected"])
    .optional(),
  fromWarehouseId: z.string().uuid().optional(),
  toWarehouseId: z.string().uuid().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateTransferDto = z.infer<typeof createTransferSchema>;
export type DeliverTransferDto = z.infer<typeof deliverTransferSchema>;
export type QueryTransferDto = z.infer<typeof queryTransferSchema>;
