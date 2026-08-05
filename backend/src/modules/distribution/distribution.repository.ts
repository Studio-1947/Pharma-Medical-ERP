import { Injectable, BadRequestException } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import { DrizzleService } from "../../database/drizzle.service";
import * as schema from "../../database/schema";

export interface CreateTransferDto {
  fromBranchId: string;
  toBranchId: string;
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
      // A batch row belongs to exactly one branch, and there is no per-branch
      // quantity split within a single batch row, so a transfer moves a batch
      // in its entirety rather than part of it.
      for (const item of data.items) {
        const [batch] = await tx
          .select({
            quantity: schema.inventoryBatches.quantity,
            reservedQty: schema.inventoryBatches.reservedQty,
            branchId: schema.inventoryBatches.branchId,
          })
          .from(schema.inventoryBatches)
          .where(eq(schema.inventoryBatches.id, item.batchId));

        if (!batch) {
          throw new BadRequestException(`Batch ${item.batchId} not found`);
        }
        if (batch.branchId !== data.fromBranchId) {
          throw new BadRequestException(
            `Batch ${item.batchId} does not belong to branch ${data.fromBranchId}`,
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
          fromBranchId: data.fromBranchId,
          toBranchId: data.toBranchId,
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

        // Source batch is always spent: whatever was not received was rejected.
        const [sourceBatch] = await tx
          .select()
          .from(schema.inventoryBatches)
          .where(eq(schema.inventoryBatches.id, item.batchId));
        if (!sourceBatch) continue;

        await tx
          .update(schema.inventoryBatches)
          .set({
            quantity: 0,
            reservedQty: 0,
            status: "depleted",
            updatedAt: new Date(),
          })
          .where(eq(schema.inventoryBatches.id, item.batchId));

        await tx.insert(schema.stockMovements).values({
          batchId: item.batchId,
          medicineId: item.medicineId,
          branchId: transfer.fromBranchId,
          movementType: "transfer_out",
          quantity: -sourceBatch.quantity,
          referenceId: id,
          referenceType: "stock_transfer",
          notes: `Dispatched on transfer ${transfer.transferNo}`,
        });

        if (ri.receivedQty > 0) {
          destLocationId ??= await this.findOrCreateDefaultLocationForBranch(
            tx,
            transfer.toBranchId,
          );

          // The destination gets its own batch row rather than the source row
          // being re-pointed. Two branches may legitimately hold the same
          // manufacturer batch number, so moving the row would collide with an
          // existing one under batch_medicine_batchno_branch_uniq — and each
          // branch's ledger should stand on its own regardless.
          const [existingAtDest] = await tx
            .select({ id: schema.inventoryBatches.id })
            .from(schema.inventoryBatches)
            .where(
              and(
                eq(schema.inventoryBatches.medicineId, item.medicineId),
                eq(schema.inventoryBatches.batchNo, sourceBatch.batchNo),
                eq(schema.inventoryBatches.branchId, transfer.toBranchId),
              ),
            );

          let destBatchId: string;
          if (existingAtDest) {
            await tx
              .update(schema.inventoryBatches)
              .set({
                quantity: sql`${schema.inventoryBatches.quantity} + ${ri.receivedQty}`,
                status: "active",
                updatedAt: new Date(),
              })
              .where(eq(schema.inventoryBatches.id, existingAtDest.id));
            destBatchId = existingAtDest.id;
          } else {
            const [created] = await tx
              .insert(schema.inventoryBatches)
              .values({
                medicineId: sourceBatch.medicineId,
                branchId: transfer.toBranchId,
                locationId: destLocationId,
                batchNo: sourceBatch.batchNo,
                manufactureDate: sourceBatch.manufactureDate,
                expiryDate: sourceBatch.expiryDate,
                quantity: ri.receivedQty,
                reservedQty: 0,
                costPrice: sourceBatch.costPrice,
                mrpAtEntry: sourceBatch.mrpAtEntry,
                supplierId: sourceBatch.supplierId,
                isConsignment: sourceBatch.isConsignment,
              })
              .returning({ id: schema.inventoryBatches.id });
            destBatchId = created!.id;
          }

          await tx.insert(schema.stockMovements).values({
            batchId: destBatchId,
            medicineId: item.medicineId,
            branchId: transfer.toBranchId,
            movementType: "transfer_in",
            quantity: ri.receivedQty,
            referenceId: id,
            referenceType: "stock_transfer",
            notes: `Received on transfer ${transfer.transferNo}`,
          });
        }

        if (rejectedQty > 0) {
          await tx.insert(schema.stockMovements).values({
            batchId: item.batchId,
            medicineId: item.medicineId,
            branchId: transfer.fromBranchId,
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

  private async findOrCreateDefaultLocationForBranch(
    tx: any,
    branchId: string,
  ): Promise<string> {
    const [existingLocation] = await tx
      .select({ id: schema.storageLocations.id })
      .from(schema.storageLocations)
      .where(eq(schema.storageLocations.branchId, branchId))
      .limit(1);

    if (existingLocation) return existingLocation.id;

    const [newLocation] = await tx
      .insert(schema.storageLocations)
      .values({
        branchId,
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
