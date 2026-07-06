import { Injectable } from "@nestjs/common";
import { and, asc, eq, gt, ilike, isNull, or, sql } from "drizzle-orm";
import { DrizzleService } from "../../database/drizzle.service";
import * as schema from "../../database/schema";
import type { CreateMedicineDto, UpdateMedicineDto, QueryMedicineDto } from "@pharmerp/types";

@Injectable()
export class InventoryRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
  }

  async findMedicinesPaginated(params: QueryMedicineDto) {
    const conditions = [
      isNull(schema.medicines.deletedAt),
      eq(schema.medicines.isActive, params.isActive ?? true),
    ];
    if (params.search) {
      const searchFilter = or(
        ilike(schema.medicines.name, `%${params.search}%`),
        ilike(schema.medicines.genericName, `%${params.search}%`),
        eq(schema.medicines.sku, params.search),
        eq(schema.medicines.barcode, params.search),
      );
      if (searchFilter) {
        conditions.push(searchFilter);
      }
    }
    if (params.categoryId) {
      conditions.push(eq(schema.medicines.categoryId, params.categoryId));
    }
    if (params.requiresPrescription !== undefined) {
      conditions.push(
        eq(schema.medicines.requiresPrescription, params.requiresPrescription),
      );
    }

    const [items, [countRow]] = await Promise.all([
      this.db
        .select({
          id: schema.medicines.id,
          name: schema.medicines.name,
          genericName: schema.medicines.genericName,
          sku: schema.medicines.sku,
          barcode: schema.medicines.barcode,
          manufacturer: schema.medicines.manufacturer,
          unit: schema.medicines.unit,
          priceMrp: schema.medicines.priceMrp,
          taxPercent: schema.medicines.taxPercent,
          reorderLevel: schema.medicines.reorderLevel,
          requiresPrescription: schema.medicines.requiresPrescription,
          isControlled: schema.medicines.isControlled,
          scheduleClass: schema.medicines.scheduleClass,
          stripSize: schema.medicines.stripSize,
          isActive: schema.medicines.isActive,
          createdAt: schema.medicines.createdAt,
        })
        .from(schema.medicines)
        .where(and(...conditions))
        .orderBy(asc(schema.medicines.name))
        .limit(params.limit)
        .offset((params.page - 1) * params.limit),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.medicines)
        .where(and(...conditions)),
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

  async findMedicineById(id: string) {
    return this.db.query.medicines.findFirst({
      where: and(eq(schema.medicines.id, id), isNull(schema.medicines.deletedAt)),
      with: { category: true },
    });
  }

  async createMedicine(data: CreateMedicineDto, createdBy?: string) {
    const [medicine] = await this.db
      .insert(schema.medicines)
      .values(data as any)
      .returning();
    return medicine;
  }

  async updateMedicine(id: string, data: UpdateMedicineDto) {
    const [medicine] = await this.db
      .update(schema.medicines)
      .set({ ...(data as any), updatedAt: new Date() })
      .where(eq(schema.medicines.id, id))
      .returning();
    return medicine;
  }

  async softDeleteMedicine(id: string) {
    await this.db
      .update(schema.medicines)
      .set({ deletedAt: new Date(), isActive: false })
      .where(eq(schema.medicines.id, id));
  }

  /** FEFO: batches ordered by expiry ASC for dispense */
  async getActiveBatchesForDispense(medicineId: string) {
    return this.db
      .select()
      .from(schema.inventoryBatches)
      .where(
        and(
          eq(schema.inventoryBatches.medicineId, medicineId),
          eq(schema.inventoryBatches.status, "active"),
          gt(schema.inventoryBatches.quantity, 0),
        ),
      )
      .orderBy(asc(schema.inventoryBatches.expiryDate));
  }

  private extractRows(result: unknown): unknown[] {
    const r = result as any;
    if (Array.isArray(r)) return r;
    if (Array.isArray(r?.rows)) return r.rows;
    return [];
  }

  async getStockValuation(warehouseId?: string) {
    const result = warehouseId
      ? await this.db.execute(sql`
          SELECT
            m.id,
            m.name,
            m.sku,
            m.schedule_class AS "scheduleClass",
            COALESCE(SUM(b.quantity), 0)::int AS "totalQty",
            COALESCE(SUM(b.quantity * CAST(b.cost_price AS FLOAT)), 0) AS "costValue",
            COALESCE(SUM(b.quantity * CAST(m.price_mrp AS FLOAT)), 0) AS "mrpValue",
            COUNT(DISTINCT b.id)::int AS "batchCount"
          FROM medicines m
          LEFT JOIN inventory_batches b ON b.medicine_id = m.id
            AND b.status = 'active'
            AND b.expiry_date > CURRENT_DATE
          LEFT JOIN storage_locations sl ON sl.id = b.location_id
          WHERE m.is_active = true AND m.deleted_at IS NULL
            AND (sl.warehouse_id = ${warehouseId} OR b.location_id IS NULL)
          GROUP BY m.id
          ORDER BY "costValue" DESC
        `)
      : await this.db.execute(sql`
          SELECT
            m.id,
            m.name,
            m.sku,
            m.schedule_class AS "scheduleClass",
            COALESCE(SUM(b.quantity), 0)::int AS "totalQty",
            COALESCE(SUM(b.quantity * CAST(b.cost_price AS FLOAT)), 0) AS "costValue",
            COALESCE(SUM(b.quantity * CAST(m.price_mrp AS FLOAT)), 0) AS "mrpValue",
            COUNT(DISTINCT b.id)::int AS "batchCount"
          FROM medicines m
          LEFT JOIN inventory_batches b ON b.medicine_id = m.id
            AND b.status = 'active'
            AND b.expiry_date > CURRENT_DATE
          WHERE m.is_active = true AND m.deleted_at IS NULL
          GROUP BY m.id
          ORDER BY "costValue" DESC
        `);
    return { data: this.extractRows(result) };
  }

  /** Fetch existing SKUs from a candidate set — used for bulk-import dedup */
  async findSkuSet(skus: string[]): Promise<Set<string>> {
    if (skus.length === 0) return new Set();
    const rows = await this.db
      .select({ sku: schema.medicines.sku })
      .from(schema.medicines)
      .where(and(isNull(schema.medicines.deletedAt)));
    const existing = new Set(rows.map((r) => r.sku));
    return new Set(skus.filter((s) => existing.has(s)));
  }

  async bulkCreateMedicines(
    rows: CreateMedicineDto[],
    createdBy?: string,
  ): Promise<number> {
    if (rows.length === 0) return 0;
    await this.db.insert(schema.medicines).values(rows as any[]);
    return rows.length;
  }

  async getLowStockMedicines() {
    const result = await this.db.execute(sql`
      SELECT m.id, m.name, m.sku, m.reorder_level,
             COALESCE(SUM(b.quantity), 0)::int AS current_stock
      FROM medicines m
      LEFT JOIN inventory_batches b ON b.medicine_id = m.id
        AND b.status = 'active' AND b.expiry_date > CURRENT_DATE
      WHERE m.is_active = true AND m.deleted_at IS NULL
      GROUP BY m.id
      HAVING COALESCE(SUM(b.quantity), 0) <= m.reorder_level
      ORDER BY current_stock ASC
    `);
    return { data: this.extractRows(result) };
  }
}
