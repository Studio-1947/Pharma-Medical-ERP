import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import { and, asc, desc, eq, gt, gte, isNull, lt, lte, ne, sql } from "drizzle-orm";
import { DrizzleService } from "../../database/drizzle.service";
import * as schema from "../../database/schema";
import type {
  CreateBatchDto,
  UpdateBatchDto,
  QueryBatchDto,
  AdjustBatchQuantityDto,
} from "@pharmerp/types";

@Injectable()
export class BatchRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
  }

  async findBatches(params: QueryBatchDto) {
    const conditions: ReturnType<typeof eq>[] = [];

    if (params.medicineId) {
      conditions.push(eq(schema.inventoryBatches.medicineId, params.medicineId) as any);
    }
    if (params.status) {
      conditions.push(eq(schema.inventoryBatches.status, params.status as any) as any);
    }
    if (params.expiringBefore) {
      conditions.push(lte(schema.inventoryBatches.expiryDate, params.expiringBefore) as any);
    }

    const where = conditions.length > 0 ? and(...(conditions as any)) : undefined;

    const [items, [countRow]] = await Promise.all([
      this.db
        .select({
          id: schema.inventoryBatches.id,
          medicineId: schema.inventoryBatches.medicineId,
          locationId: schema.inventoryBatches.locationId,
          batchNo: schema.inventoryBatches.batchNo,
          expiryDate: schema.inventoryBatches.expiryDate,
          quantity: schema.inventoryBatches.quantity,
          costPrice: schema.inventoryBatches.costPrice,
          mrpAtEntry: schema.inventoryBatches.mrpAtEntry,
          status: schema.inventoryBatches.status,
          createdAt: schema.inventoryBatches.createdAt,
        })
        .from(schema.inventoryBatches)
        .where(where)
        .orderBy(asc(schema.inventoryBatches.expiryDate))
        .limit(params.limit)
        .offset((params.page - 1) * params.limit),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.inventoryBatches)
        .where(where),
    ]);

    return {
      data: items,
      meta: {
        page: params.page,
        limit: params.limit,
        total: countRow?.count ?? 0,
        totalPages: Math.ceil((countRow?.count ?? 0) / params.limit),
      },
    };
  }

  async findBatchById(id: string) {
    return this.db.query.inventoryBatches.findFirst({
      where: eq(schema.inventoryBatches.id, id),
      with: { medicine: true, location: true },
    });
  }

  async checkBatchNoExists(medicineId: string, batchNo: string, excludeId?: string): Promise<boolean> {
    const conditions: any[] = [
      eq(schema.inventoryBatches.medicineId, medicineId),
      eq(schema.inventoryBatches.batchNo, batchNo),
    ];
    if (excludeId) {
      conditions.push(ne(schema.inventoryBatches.id, excludeId));
    }
    const [row] = await this.db
      .select({ id: schema.inventoryBatches.id })
      .from(schema.inventoryBatches)
      .where(and(...conditions))
      .limit(1);
    return !!row;
  }

  async createBatch(data: CreateBatchDto & { resolvedLocationId?: string }) {
    const duplicate = await this.checkBatchNoExists(data.medicineId, data.batchNo);
    if (duplicate) {
      throw new UnprocessableEntityException(
        `Batch number "${data.batchNo}" already exists for this medicine. Use a unique batch number.`,
      );
    }

    const [batch] = await this.db
      .insert(schema.inventoryBatches)
      .values({
        medicineId: data.medicineId,
        locationId: data.resolvedLocationId ?? data.locationId,
        batchNo: data.batchNo,
        expiryDate: data.expiryDate,
        quantity: data.quantity,
        costPrice: data.costPrice,
        mrpAtEntry: data.mrpAtEntry,
        poId: data.poId,
        grnId: data.grnId,
      })
      .returning();
    return batch!;
  }

  async updateBatch(id: string, data: UpdateBatchDto) {
    if (data.batchNo !== undefined) {
      const duplicate = await this.checkBatchNoExists(
        (await this.findBatchById(id))!.medicineId,
        data.batchNo,
        id,
      );
      if (duplicate) {
        throw new UnprocessableEntityException(
          `Batch number "${data.batchNo}" already exists for this medicine.`,
        );
      }
    }

    const [updated] = await this.db
      .update(schema.inventoryBatches)
      .set({
        ...(data.batchNo !== undefined && { batchNo: data.batchNo }),
        ...(data.expiryDate !== undefined && { expiryDate: data.expiryDate }),
        ...(data.costPrice !== undefined && { costPrice: data.costPrice }),
        ...(data.mrpAtEntry !== undefined && { mrpAtEntry: data.mrpAtEntry }),
        ...(data.status !== undefined && { status: data.status as any }),
        updatedAt: new Date(),
      })
      .where(eq(schema.inventoryBatches.id, id))
      .returning();
    return updated!;
  }

  /**
   * Returns the first storage location for a branch, creating a default
   * warehouse + location if none exists. Ensures every directly-created batch
   * has a locationId so selectBatchesForDispense can find it.
   */
  async findOrCreateDefaultLocationForBranch(branchId: string): Promise<string> {
    // Find existing warehouse for branch
    const [existingWarehouse] = await this.db
      .select({ id: schema.warehouses.id })
      .from(schema.warehouses)
      .where(and(eq(schema.warehouses.branchId, branchId), eq(schema.warehouses.isActive, true)))
      .limit(1);

    let warehouseId: string;
    if (existingWarehouse) {
      warehouseId = existingWarehouse.id;
    } else {
      const [newWarehouse] = await this.db
        .insert(schema.warehouses)
        .values({ branchId, name: "Main Store", code: `WH-${branchId.slice(0, 8).toUpperCase()}`, isDefault: true })
        .returning({ id: schema.warehouses.id });
      warehouseId = newWarehouse!.id;
    }

    // Find existing storage location in warehouse
    const [existingLocation] = await this.db
      .select({ id: schema.storageLocations.id })
      .from(schema.storageLocations)
      .where(eq(schema.storageLocations.warehouseId, warehouseId))
      .limit(1);

    if (existingLocation) return existingLocation.id;

    const [newLocation] = await this.db
      .insert(schema.storageLocations)
      .values({ warehouseId, label: "Default Shelf", aisle: "A", shelf: "1", bin: "1" })
      .returning({ id: schema.storageLocations.id });
    return newLocation!.id;
  }

  async updateBatchStatus(id: string, status: string) {
    const [batch] = await this.db
      .update(schema.inventoryBatches)
      .set({ status: status as any, updatedAt: new Date() })
      .where(eq(schema.inventoryBatches.id, id))
      .returning();
    return batch!;
  }

  /**
   * Atomic quantity adjustment — guards against going negative.
   * Returns the new quantity. Must be called inside a transaction for
   * multi-step dispense flows.
   */
  async adjustQuantity(id: string, delta: number, tx?: typeof schema) {
    const db = (tx as any) ?? this.db;
    const [updated] = await db
      .update(schema.inventoryBatches)
      .set({
        quantity: sql`${schema.inventoryBatches.quantity} + ${delta}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.inventoryBatches.id, id),
          // Prevent negative stock
          delta < 0
            ? gt(schema.inventoryBatches.quantity, Math.abs(delta) - 1)
            : sql`true`,
        ),
      )
      .returning({ id: schema.inventoryBatches.id, quantity: schema.inventoryBatches.quantity });
    return updated;
  }

  /** Batches expiring within `days` days that are still active, filtered by branch */
  async findExpiringBatches(days: number, branchId?: string) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + days);
    const cutoffStr = cutoff.toISOString().split("T")[0]!;

    const conditions = [
      eq(schema.inventoryBatches.status, "active"),
      gt(schema.inventoryBatches.quantity, 0),
      lte(schema.inventoryBatches.expiryDate, cutoffStr),
    ];

    if (branchId) {
      conditions.push(eq(schema.warehouses.branchId, branchId));
    }

    return this.db
      .select({
        id: schema.inventoryBatches.id,
        medicineId: schema.inventoryBatches.medicineId,
        batchNo: schema.inventoryBatches.batchNo,
        expiryDate: schema.inventoryBatches.expiryDate,
        quantity: schema.inventoryBatches.quantity,
        status: schema.inventoryBatches.status,
      })
      .from(schema.inventoryBatches)
      .innerJoin(
        schema.storageLocations,
        eq(schema.inventoryBatches.locationId, schema.storageLocations.id),
      )
      .innerJoin(
        schema.warehouses,
        eq(schema.storageLocations.warehouseId, schema.warehouses.id),
      )
      .where(and(...conditions))
      .orderBy(asc(schema.inventoryBatches.expiryDate));
  }

  /** Mark batches whose expiryDate < today as expired */
  async markExpiredBatches() {
    const today = new Date().toISOString().split("T")[0]!;
    const updated = await this.db
      .update(schema.inventoryBatches)
      .set({ status: "expired", updatedAt: new Date() })
      .where(
        and(
          eq(schema.inventoryBatches.status, "active"),
          lt(schema.inventoryBatches.expiryDate, today),
        ),
      )
      .returning({ id: schema.inventoryBatches.id });
    return updated;
  }

  /**
   * FEFO batch selector. Call INSIDE a Drizzle transaction (pass tx).
   * Skips: expired (expiryDate <= today), non-active, zero-qty.
   * Throws UnprocessableEntityException if available < needed.
   */
  async selectBatchesForDispense(
    medicineId: string,
    needed: number,
    tx?: any,
  ): Promise<Array<{ batchId: string; batchNo: string; expiryDate: string; allocate: number; mrpAtEntry: string }>> {
    const db = tx ?? this.db;
    const today = new Date().toISOString().split("T")[0]!;

    const batches = await db
      .select({
        id: schema.inventoryBatches.id,
        batchNo: schema.inventoryBatches.batchNo,
        expiryDate: schema.inventoryBatches.expiryDate,
        quantity: schema.inventoryBatches.quantity,
        mrpAtEntry: schema.inventoryBatches.mrpAtEntry,
      })
      .from(schema.inventoryBatches)
      .where(
        and(
          eq(schema.inventoryBatches.medicineId, medicineId),
          eq(schema.inventoryBatches.status, "active"),
          gt(schema.inventoryBatches.quantity, 0),
          gt(schema.inventoryBatches.expiryDate, today),
        ),
      )
      .orderBy(asc(schema.inventoryBatches.expiryDate));

    const allocations: Array<{ batchId: string; batchNo: string; expiryDate: string; allocate: number; mrpAtEntry: string }> = [];
    let remaining = needed;

    for (const batch of batches) {
      if (remaining <= 0) break;
      const take = Math.min(batch.quantity, remaining);
      allocations.push({
        batchId: batch.id,
        batchNo: batch.batchNo,
        expiryDate: batch.expiryDate,
        allocate: take,
        mrpAtEntry: batch.mrpAtEntry,
      });
      remaining -= take;
    }

    if (remaining > 0) {
      const available = needed - remaining;
      throw new UnprocessableEntityException(
        `Insufficient stock for medicine ${medicineId}: requested ${needed}, available ${available}`,
      );
    }

    return allocations;
  }

  async hasMovements(batchId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: schema.stockMovements.id })
      .from(schema.stockMovements)
      .where(eq(schema.stockMovements.batchId, batchId))
      .limit(1);
    return !!row;
  }

  async deleteBatch(id: string): Promise<void> {
    await this.db
      .delete(schema.inventoryBatches)
      .where(eq(schema.inventoryBatches.id, id));
  }
}
