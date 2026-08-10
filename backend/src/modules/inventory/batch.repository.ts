import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, ne, sql } from "drizzle-orm";
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
          medicineName: schema.medicines.name,
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
        .leftJoin(schema.medicines, eq(schema.inventoryBatches.medicineId, schema.medicines.id))
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

  /**
   * Scoped by branch, mirroring the batch_medicine_batchno_branch_uniq index.
   *
   * Without the branchId term this check stayed global while the database
   * constraint became per-branch — the application would refuse a batch number
   * that Postgres was perfectly willing to accept, which is exactly the
   * cross-branch collision the migration set out to fix.
   */
  async checkBatchNoExists(
    medicineId: string,
    batchNo: string,
    branchId: string,
    excludeId?: string,
  ): Promise<boolean> {
    const conditions: any[] = [
      eq(schema.inventoryBatches.medicineId, medicineId),
      eq(schema.inventoryBatches.batchNo, batchNo),
      eq(schema.inventoryBatches.branchId, branchId),
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

  async createBatch(
    data: CreateBatchDto & { resolvedLocationId?: string; branchId: string },
  ) {
    const duplicate = await this.checkBatchNoExists(
      data.medicineId,
      data.batchNo,
      data.branchId,
    );
    if (duplicate) {
      throw new UnprocessableEntityException(
        `Batch number "${data.batchNo}" already exists for this medicine in this branch. Use a unique batch number.`,
      );
    }

    const [batch] = await this.db
      .insert(schema.inventoryBatches)
      .values({
        medicineId: data.medicineId,
        branchId: data.branchId,
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
   * Returns a storage location for a branch, creating a default shelf if the
   * branch has none.
   *
   * Shelf assignment is now cosmetic for stock ownership — a batch carries its
   * own branchId — but locations still describe where staff physically find the
   * pack, so new batches are given one.
   */
  async findOrCreateDefaultLocationForBranch(branchId: string): Promise<string> {
    const [existingLocation] = await this.db
      .select({ id: schema.storageLocations.id })
      .from(schema.storageLocations)
      .where(eq(schema.storageLocations.branchId, branchId))
      .limit(1);

    if (existingLocation) return existingLocation.id;

    const [newLocation] = await this.db
      .insert(schema.storageLocations)
      .values({ branchId, label: "Default Shelf", aisle: "A", shelf: "1", bin: "1" })
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
      conditions.push(eq(schema.inventoryBatches.branchId, branchId));
    }

    // Reads branchId straight off the batch. The old form inner-joined through
    // storage_locations to warehouses, which silently dropped every batch with
    // no shelf assigned — those simply never appeared in expiry alerts.
    return this.db
      .select({
        id: schema.inventoryBatches.id,
        medicineId: schema.inventoryBatches.medicineId,
        medicineName: schema.medicines.name,
        branchId: schema.inventoryBatches.branchId,
        batchNo: schema.inventoryBatches.batchNo,
        expiryDate: schema.inventoryBatches.expiryDate,
        quantity: schema.inventoryBatches.quantity,
        status: schema.inventoryBatches.status,
      })
      .from(schema.inventoryBatches)
      .leftJoin(schema.medicines, eq(schema.inventoryBatches.medicineId, schema.medicines.id))
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

    let batchQuery = db
      .select({
        id: schema.inventoryBatches.id,
        batchNo: schema.inventoryBatches.batchNo,
        expiryDate: schema.inventoryBatches.expiryDate,
        quantity: schema.inventoryBatches.quantity,
        reservedQty: schema.inventoryBatches.reservedQty,
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

    if (tx && typeof (batchQuery as any).for === "function") {
      batchQuery = (batchQuery as any).for("update");
    }

    const batches = await batchQuery;

    const allocations: Array<{ batchId: string; batchNo: string; expiryDate: string; allocate: number; mrpAtEntry: string }> = [];
    let remaining = needed;

    for (const batch of batches) {
      if (remaining <= 0) break;
      // A batch fully reserved for an in-transit stock transfer has no
      // sellable quantity left, even though its raw `quantity` is unchanged.
      const sellable = batch.quantity - batch.reservedQty;
      if (sellable <= 0) continue;
      const take = Math.min(sellable, remaining);
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

  /**
   * Same FEFO allocation as `selectBatchesForDispense`, but for several
   * medicines at once in a single query — use during checkout instead of
   * calling `selectBatchesForDispense` once per cart line.
   *
   * Returns one allocation list per entry in `needs`, aligned by array
   * index (not keyed by medicineId) so two cart lines for the same
   * medicine each get their own independent FEFO pass over the remaining
   * batch quantities, in the order given.
   */
  /**
   * FEFO allocation for a checkout, scoped to the selling branch.
   *
   * `branchId` is required, not optional: a till can only dispense packs that
   * are physically on its own shelves. Without the filter this allocated the
   * oldest batch anywhere in the company, so a sale at one branch decremented
   * another branch's stock for a pack that was never in the building — and both
   * branches' figures were wrong afterwards.
   */
  async selectBatchesForDispenseMulti(
    needs: { medicineId: string; needed: number }[],
    branchId: string,
    tx?: any,
  ): Promise<Array<{ batchId: string; batchNo: string; expiryDate: string; allocate: number; mrpAtEntry: string }>[]> {
    const db = tx ?? this.db;
    const today = new Date().toISOString().split("T")[0]!;
    const medicineIds = [...new Set(needs.map((n) => n.medicineId))];

    let multiQuery = medicineIds.length
      ? db
          .select({
            id: schema.inventoryBatches.id,
            medicineId: schema.inventoryBatches.medicineId,
            batchNo: schema.inventoryBatches.batchNo,
            expiryDate: schema.inventoryBatches.expiryDate,
            quantity: schema.inventoryBatches.quantity,
            reservedQty: schema.inventoryBatches.reservedQty,
            mrpAtEntry: schema.inventoryBatches.mrpAtEntry,
          })
          .from(schema.inventoryBatches)
          .where(
            and(
              inArray(schema.inventoryBatches.medicineId, medicineIds),
              eq(schema.inventoryBatches.branchId, branchId),
              eq(schema.inventoryBatches.status, "active"),
              gt(schema.inventoryBatches.quantity, 0),
              gt(schema.inventoryBatches.expiryDate, today),
            ),
          )
          .orderBy(asc(schema.inventoryBatches.expiryDate))
      : null;

    if (tx && multiQuery && typeof (multiQuery as any).for === "function") {
      multiQuery = (multiQuery as any).for("update");
    }

    const batches = multiQuery ? await multiQuery : [];

    // Mutable per-batch running "sellable" counter — shared across every
    // `needs` entry for the same medicine, so two cart lines for the same
    // medicine deplete the same pool in FEFO order instead of each seeing
    // the full untouched quantity.
    const batchesByMedicine = new Map<
      string,
      Array<{ id: string; batchNo: string; expiryDate: string; mrpAtEntry: string; sellable: number }>
    >();
    for (const batch of batches) {
      const list = batchesByMedicine.get(batch.medicineId) ?? [];
      list.push({
        id: batch.id,
        batchNo: batch.batchNo,
        expiryDate: batch.expiryDate,
        mrpAtEntry: batch.mrpAtEntry,
        sellable: batch.quantity - batch.reservedQty,
      });
      batchesByMedicine.set(batch.medicineId, list);
    }

    const result: Array<{ batchId: string; batchNo: string; expiryDate: string; allocate: number; mrpAtEntry: string }>[] = [];

    for (const { medicineId, needed } of needs) {
      const allocations: Array<{ batchId: string; batchNo: string; expiryDate: string; allocate: number; mrpAtEntry: string }> = [];
      let remaining = needed;

      for (const batch of batchesByMedicine.get(medicineId) ?? []) {
        if (remaining <= 0) break;
        if (batch.sellable <= 0) continue;
        const take = Math.min(batch.sellable, remaining);
        allocations.push({
          batchId: batch.id,
          batchNo: batch.batchNo,
          expiryDate: batch.expiryDate,
          allocate: take,
          mrpAtEntry: batch.mrpAtEntry,
        });
        batch.sellable -= take;
        remaining -= take;
      }

      if (remaining > 0) {
        const available = needed - remaining;
        throw new UnprocessableEntityException(
          `Insufficient stock for medicine ${medicineId}: requested ${needed}, available ${available}`,
        );
      }

      result.push(allocations);
    }

    return result;
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

  async reserveStock(batchId: string, quantity: number) {
    const [updated] = await this.db
      .update(schema.inventoryBatches)
      .set({
        reservedQty: sql`${schema.inventoryBatches.reservedQty} + ${quantity}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.inventoryBatches.id, batchId),
          gte(sql`${schema.inventoryBatches.quantity} - ${schema.inventoryBatches.reservedQty}`, quantity),
        ),
      )
      .returning();

    if (!updated) {
      throw new UnprocessableEntityException(
        `Cannot reserve ${quantity} units: batch ${batchId} has insufficient unreserved stock`,
      );
    }
    return updated;
  }

  async releaseStock(batchId: string, quantity: number) {
    const [updated] = await this.db
      .update(schema.inventoryBatches)
      .set({
        reservedQty: sql`GREATEST(0, ${schema.inventoryBatches.reservedQty} - ${quantity})`,
        updatedAt: new Date(),
      })
      .where(eq(schema.inventoryBatches.id, batchId))
      .returning();

    if (!updated) {
      throw new UnprocessableEntityException(`Batch ${batchId} not found`);
    }
    return updated;
  }
}
