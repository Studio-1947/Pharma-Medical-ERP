import { Injectable, BadRequestException } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import { DrizzleService } from "../../database/drizzle.service";
import * as schema from "../../database/schema";

export interface CreateTransferDto {
  fromWarehouseId: string;
  toWarehouseId: string;
  notes?: string;
  items: {
    medicineId: string;
    batchId: string;
    requestedQty: number;
    notes?: string;
  }[];
}

export interface UpdateTransferStatusDto {
  status: "in_transit" | "delivered" | "rejected";
  podFileUrl?: string;
}

@Injectable()
export class DistributionRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
  }

  async findAll(params: { page: number; limit: number; status?: string }) {
    const conditions: any[] = [];
    if (params.status) {
      conditions.push(eq(schema.stockTransfers.status, params.status as any));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, [countRow]] = await Promise.all([
      this.db
        .select()
        .from(schema.stockTransfers)
        .where(where)
        .orderBy(desc(schema.stockTransfers.createdAt))
        .limit(params.limit)
        .offset((params.page - 1) * params.limit),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.stockTransfers)
        .where(where),
    ]);

    return {
      data: items,
      meta: { page: params.page, limit: params.limit, total: countRow?.count ?? 0 },
    };
  }

  async findById(id: string) {
    const [transfer] = await this.db
      .select()
      .from(schema.stockTransfers)
      .where(eq(schema.stockTransfers.id, id));

    if (!transfer) return null;

    const items = await this.db
      .select()
      .from(schema.stockTransferItems)
      .where(eq(schema.stockTransferItems.transferId, id));

    return { ...transfer!, items };
  }

  async create(data: CreateTransferDto, initiatedBy: string) {
    const transferNo = `TRF-${Date.now()}`;

    return this.db.transaction(async (tx) => {
      // A batch is tied to exactly one storage location (and therefore one
      // warehouse) at a time — the schema has no per-warehouse quantity
      // split for the same batch number. So a transfer can only move a
      // batch in its entirety, not part of it.
      for (const item of data.items) {
        const [batch] = await tx
          .select({
            quantity: schema.inventoryBatches.quantity,
            reservedQty: schema.inventoryBatches.reservedQty,
            warehouseId: schema.storageLocations.warehouseId,
          })
          .from(schema.inventoryBatches)
          .leftJoin(
            schema.storageLocations,
            eq(schema.inventoryBatches.locationId, schema.storageLocations.id),
          )
          .where(eq(schema.inventoryBatches.id, item.batchId));

        if (!batch) {
          throw new BadRequestException(`Batch ${item.batchId} not found`);
        }
        if (batch.warehouseId !== data.fromWarehouseId) {
          throw new BadRequestException(
            `Batch ${item.batchId} does not belong to warehouse ${data.fromWarehouseId}`,
          );
        }
        const available = batch.quantity - batch.reservedQty;
        if (item.requestedQty !== available) {
          throw new BadRequestException(
            `Batch ${item.batchId} has ${available} units available — transfers must move the full batch quantity (requested ${item.requestedQty})`,
          );
        }
      }

      const [transfer] = await tx
        .insert(schema.stockTransfers)
        .values({
          transferNo,
          fromWarehouseId: data.fromWarehouseId,
          toWarehouseId: data.toWarehouseId,
          initiatedBy,
          notes: data.notes,
          status: "draft",
        })
        .returning();

      if (data.items.length > 0) {
        await tx.insert(schema.stockTransferItems).values(
          data.items.map((item) => ({
            transferId: transfer!.id,
            medicineId: item.medicineId,
            batchId: item.batchId,
            requestedQty: item.requestedQty,
            notes: item.notes,
          })),
        );
      }

      return transfer;
    });
  }

  async approve(id: string, approvedBy: string) {
    return this.db.transaction(async (tx) => {
      const [transfer] = await tx
        .update(schema.stockTransfers)
        .set({ status: "in_transit", approvedBy, dispatchedAt: new Date() })
        .where(
          and(
            eq(schema.stockTransfers.id, id),
            eq(schema.stockTransfers.status, "draft"),
          ),
        )
        .returning();

      if (!transfer) return null;

      const items = await tx
        .select()
        .from(schema.stockTransferItems)
        .where(eq(schema.stockTransferItems.transferId, id));

      for (const item of items) {
        // Reserve the full batch so it can't be sold or re-transferred
        // while it's in transit. Conditional guard: only succeeds if the
        // batch still has enough unreserved stock right now.
        const [reserved] = await tx
          .update(schema.inventoryBatches)
          .set({
            reservedQty: sql`${schema.inventoryBatches.quantity}`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.inventoryBatches.id, item.batchId),
              eq(schema.inventoryBatches.reservedQty, 0),
              sql`${schema.inventoryBatches.quantity} >= ${item.requestedQty}`,
            ),
          )
          .returning({ id: schema.inventoryBatches.id });

        if (!reserved) {
          throw new BadRequestException(
            `Batch ${item.batchId} is no longer available to reserve for dispatch (already reserved or insufficient stock)`,
          );
        }

        await tx
          .update(schema.stockTransferItems)
          .set({ sentQty: item.requestedQty })
          .where(eq(schema.stockTransferItems.id, item.id));
      }

      return transfer;
    });
  }

  async deliver(
    id: string,
    dto: UpdateTransferStatusDto,
    receivedItems: { itemId: string; receivedQty: number; rejectedQty?: number }[],
  ) {
    return this.db.transaction(async (tx) => {
      const [transfer] = await tx
        .select()
        .from(schema.stockTransfers)
        .where(eq(schema.stockTransfers.id, id));
      if (!transfer) return null;

      const items = await tx
        .select()
        .from(schema.stockTransferItems)
        .where(eq(schema.stockTransferItems.transferId, id));
      const itemMap = new Map(items.map((i) => [i.id, i]));

      let destLocationId: string | null = null;

      for (const ri of receivedItems) {
        const item = itemMap.get(ri.itemId);
        if (!item) continue;

        const rejectedQty = ri.rejectedQty ?? 0;

        await tx
          .update(schema.stockTransferItems)
          .set({
            receivedQty: ri.receivedQty,
            rejectedQty,
            sentQty: ri.receivedQty + rejectedQty,
          })
          .where(eq(schema.stockTransferItems.id, ri.itemId));

        if (ri.receivedQty > 0) {
          destLocationId ??= await this.findOrCreateDefaultLocationForWarehouse(
            tx,
            transfer.toWarehouseId,
          );
          // Relocate the batch to the destination warehouse — same row,
          // since (medicineId, batchNo) must stay unique across the table.
          await tx
            .update(schema.inventoryBatches)
            .set({
              locationId: destLocationId,
              quantity: ri.receivedQty,
              reservedQty: 0,
              updatedAt: new Date(),
            })
            .where(eq(schema.inventoryBatches.id, item.batchId));
        } else {
          // Fully rejected on receipt — nothing moves; the batch is spent.
          await tx
            .update(schema.inventoryBatches)
            .set({
              quantity: 0,
              reservedQty: 0,
              status: "depleted",
              updatedAt: new Date(),
            })
            .where(eq(schema.inventoryBatches.id, item.batchId));
        }

        if (rejectedQty > 0) {
          await tx.insert(schema.stockMovements).values({
            batchId: item.batchId,
            medicineId: item.medicineId,
            movementType: "transfer_reject_writeoff",
            quantity: -rejectedQty,
            referenceId: id,
            referenceType: "stock_transfer",
            notes: `Rejected on receipt for transfer ${transfer.transferNo}`,
          });
        }
      }

      const [updated] = await tx
        .update(schema.stockTransfers)
        .set({
          status: dto.status,
          podFileUrl: dto.podFileUrl,
          deliveredAt: new Date(),
        })
        .where(eq(schema.stockTransfers.id, id))
        .returning();

      return updated;
    });
  }

  private async findOrCreateDefaultLocationForWarehouse(
    tx: any,
    warehouseId: string,
  ): Promise<string> {
    const [existingLocation] = await tx
      .select({ id: schema.storageLocations.id })
      .from(schema.storageLocations)
      .where(eq(schema.storageLocations.warehouseId, warehouseId))
      .limit(1);

    if (existingLocation) return existingLocation.id;

    const [newLocation] = await tx
      .insert(schema.storageLocations)
      .values({
        warehouseId,
        label: "Default Shelf",
        aisle: "A",
        shelf: "1",
        bin: "1",
      })
      .returning({ id: schema.storageLocations.id });
    return newLocation!.id;
  }

  async cancel(id: string) {
    const [updated] = await this.db
      .update(schema.stockTransfers)
      .set({ status: "rejected" })
      .where(
        and(
          eq(schema.stockTransfers.id, id),
          eq(schema.stockTransfers.status, "draft"),
        ),
      )
      .returning();
    return updated ?? null;
  }
}
