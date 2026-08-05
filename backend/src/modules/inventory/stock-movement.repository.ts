import { Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { DrizzleService } from "../../database/drizzle.service";
import * as schema from "../../database/schema";

export type MovementType =
  | "sale"
  | "purchase"
  | "transfer_in"
  | "transfer_out"
  | "return"
  | "adjustment"
  | "expiry_write_off";

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
}
