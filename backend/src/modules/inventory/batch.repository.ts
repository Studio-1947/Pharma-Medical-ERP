import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gt, isNull, lt, lte, sql } from "drizzle-orm";
import { DrizzleService } from "../../database/drizzle.service";
import * as schema from "../../database/schema";
import type {
  CreateBatchDto,
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

  async createBatch(data: CreateBatchDto) {
    const [batch] = await this.db
      .insert(schema.inventoryBatches)
      .values({
        medicineId: data.medicineId,
        locationId: data.locationId,
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

  /** Batches expiring within `days` days that are still active */
  async findExpiringBatches(days: number) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + days);
    const cutoffStr = cutoff.toISOString().split("T")[0]!;

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
      .where(
        and(
          eq(schema.inventoryBatches.status, "active"),
          gt(schema.inventoryBatches.quantity, 0),
          lte(schema.inventoryBatches.expiryDate, cutoffStr),
        ),
      )
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
}
