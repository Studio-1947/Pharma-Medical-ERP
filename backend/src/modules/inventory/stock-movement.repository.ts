import { Injectable } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import { DrizzleService } from "../../database/drizzle.service";
import * as schema from "../../database/schema";

export type MovementType =
  | "sale"
  | "purchase"
  | "transfer_in"
  | "transfer_out"
  | "return"
  | "adjustment"
  | "expiry_write_off"
  | "otc_supply";

@Injectable()
export class StockMovementRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
  }

  /**
   * Log a stock movement. Pass a transaction `tx` when called inside a
   * multi-step atomic operation (e.g. dispense + invoice).
   */
  async log(
    data: {
      batchId: string;
      medicineId: string;
      /** Branch whose stock moved. Required — the ledger is read per branch. */
      branchId: string;
      movementType: MovementType;
      quantity: number;
      referenceId?: string;
      referenceType?: string;
      performedBy?: string;
      notes?: string;
    },
    tx?: any,
  ) {
    const db = tx ?? this.db;
    const [movement] = await db
      .insert(schema.stockMovements)
      .values(data)
      .returning();
    return movement;
  }

  /**
   * Insert multiple stock movements in a single round trip — use in place
   * of calling `log()` in a loop when logging several movements at once
   * (e.g. one per cart line during checkout).
   */
  async logMany(
    rows: {
      batchId: string;
      medicineId: string;
      branchId: string;
      movementType: MovementType;
      quantity: number;
      referenceId?: string;
      referenceType?: string;
      performedBy?: string;
      notes?: string;
    }[],
    tx?: any,
  ) {
    if (rows.length === 0) return [];
    const db = tx ?? this.db;
    return db.insert(schema.stockMovements).values(rows).returning();
  }

  /** Movement history for a medicine, optionally narrowed to one branch. */
  async findByMedicine(medicineId: string, limit = 50, branchId?: string) {
    const conditions = [eq(schema.stockMovements.medicineId, medicineId)];
    if (branchId) {
      conditions.push(eq(schema.stockMovements.branchId, branchId));
    }
    return this.db
      .select()
      .from(schema.stockMovements)
      .where(and(...conditions))
      .orderBy(desc(schema.stockMovements.createdAt))
      .limit(limit);
  }

  async findByBatch(batchId: string) {
    return this.db
      .select()
      .from(schema.stockMovements)
      .where(eq(schema.stockMovements.batchId, batchId))
      .orderBy(desc(schema.stockMovements.createdAt));
  }

  /**
   * OTC supplies (hand-outs without an invoice) on a given date, optionally
   * narrowed to a branch — powers the counter desk's "OTC medicines supplied
   * today" stat card, including the per-supply record list.
   */
  async findOtcSupplies(date: string, branchId?: string) {
    const conditions = [
      eq(schema.stockMovements.movementType, "otc_supply"),
      sql`${schema.stockMovements.createdAt} >= ${date}::date`,
      sql`${schema.stockMovements.createdAt} < (${date}::date + interval '1 day')`,
    ];
    if (branchId) conditions.push(eq(schema.stockMovements.branchId, branchId));

    const [summaryRow, records] = await Promise.all([
      this.db
        .select({
          count: sql<number>`count(*)::int`,
          // Each supply row records a negative quantity — total units handed out.
          units: sql<number>`coalesce(sum(-quantity), 0)::int`,
        })
        .from(schema.stockMovements)
        .where(and(...conditions)),
      this.db
        .select({
          id: schema.stockMovements.id,
          medicineId: schema.stockMovements.medicineId,
          medicineName: schema.medicines.name,
          batchNo: schema.inventoryBatches.batchNo,
          batchId: schema.stockMovements.batchId,
          branchId: schema.stockMovements.branchId,
          quantity: schema.stockMovements.quantity,
          notes: schema.stockMovements.notes,
          performedBy: schema.stockMovements.performedBy,
          performedByName: schema.users.email,
          createdAt: schema.stockMovements.createdAt,
        })
        .from(schema.stockMovements)
        .leftJoin(
          schema.medicines,
          eq(schema.stockMovements.medicineId, schema.medicines.id),
        )
        .leftJoin(
          schema.inventoryBatches,
          eq(schema.stockMovements.batchId, schema.inventoryBatches.id),
        )
        .leftJoin(schema.users, eq(schema.stockMovements.performedBy, schema.users.id))
        .where(and(...conditions))
        .orderBy(desc(schema.stockMovements.createdAt))
        .limit(100),
    ]);

    return {
      supplies: Number(summaryRow?.[0]?.count ?? 0),
      units: Number(summaryRow?.[0]?.units ?? 0),
      records: records.map((r) => ({
        ...r,
        // Each row stores a negative quantity; surface the positive count.
        quantity: Math.abs(Number(r.quantity ?? 0)),
      })),
    };
  }
}
