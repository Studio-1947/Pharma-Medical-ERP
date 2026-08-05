import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gt, gte, ilike, isNull, ne, or, sql } from "drizzle-orm";
import { DrizzleService } from "../../database/drizzle.service";
import * as schema from "../../database/schema";
import type { CreateMedicineDto, UpdateMedicineDto, QueryMedicineDto } from "@pharmerp/types";

/** Postgres binds parameters with an Int16 count, so one statement can carry at
 *  most 65535 of them. A 5.5k-row catalogue insert is far past that (27 columns
 *  x 5536 rows = ~149k), so every bulk insert goes out in chunks sized to stay
 *  clear of the ceiling. */
const MAX_BIND_PARAMS = 60000;

function chunkForColumns<T>(rows: T[], columnCount: number): T[][] {
  const perChunk = Math.max(1, Math.floor(MAX_BIND_PARAMS / Math.max(1, columnCount)));
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += perChunk) {
    chunks.push(rows.slice(i, i + perChunk));
  }
  return chunks;
}

/** Widest row in the set — rows are sparse (optional CSV columns are absent),
 *  and Drizzle binds the union of keys across the whole insert. */
function widestRow(rows: object[]): number {
  return rows.reduce((max, r) => Math.max(max, Object.keys(r).length), 1);
}

/** Split a rack label into its addressable parts so the location is filterable
 *  rather than one opaque string. "Rack C-2, Shelf 2" -> aisle "C-2", shelf
 *  "2"; "Cold Chain Refrigerator (2-8 C) - Shelf 4" -> shelf "4". Anything that
 *  does not match keeps the full label and leaves the parts null. */
function parseLocationLabel(label: string): {
  label: string;
  aisle?: string;
  shelf?: string;
  isRefrigerated: boolean;
} {
  const aisle = label.match(/(?:rack|aisle)\s+([A-Za-z]+-?\d*)/i)?.[1];
  const shelf = label.match(/shelf\s+(\w+)/i)?.[1];
  return {
    label: label.slice(0, 50),
    aisle: aisle?.slice(0, 10),
    shelf: shelf?.slice(0, 10),
    // Cold-chain racks must be flagged: a vaccine put on an ambient shelf is a
    // product-safety problem, and the label is the only signal the CSV carries.
    isRefrigerated: /cold\s*chain|refrigerat|freezer|2-8\s*c/i.test(label),
  };
}

/** Shared with the importer: identity of a medicine that has no catalogue id of
 *  its own. Case, spacing and cosmetic punctuation are ignored so a re-import
 *  matches a product it created earlier even if the sheet was lightly retyped. */
export function normalizedIdentity(name: string, manufacturer?: string | null): string {
  const norm = (s: string) => s.replace(/[^a-z0-9+&/]/gi, "").toLowerCase();
  return `${norm(name)}|${norm(manufacturer ?? "")}`;
}

/** Supplier codes are unique and NOT NULL, but a catalogue import supplies only
 *  a name. Build one from the name's initials and disambiguate on collision. */
function uniqueSupplierCode(name: string, taken: Set<string>): string {
  const base =
    name
      .replace(/[^A-Za-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0]!.toUpperCase())
      .join("")
      .slice(0, 6) || "SUP";
  let code = base;
  for (let n = 2; taken.has(code); n++) code = `${base}-${n}`;
  taken.add(code);
  return code;
}

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
        ilike(schema.medicines.brandName, `%${params.search}%`),
        ilike(schema.medicines.genericName, `%${params.search}%`),
        ilike(schema.medicines.composition, `%${params.search}%`),
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
          brandName: schema.medicines.brandName,
          genericName: schema.medicines.genericName,
          strength: schema.medicines.strength,
          dosageForm: schema.medicines.dosageForm,
          packSize: schema.medicines.packSize,
          sku: schema.medicines.sku,
          barcode: schema.medicines.barcode,
          manufacturer: schema.medicines.manufacturer,
          therapeuticClass: schema.medicines.therapeuticClass,
          unit: schema.medicines.unit,
          priceMrp: schema.medicines.priceMrp,
          purchaseRate: schema.medicines.purchaseRate,
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

  /** Full active medicine row by exact barcode (uses medicines_barcode_idx). */
  async findActiveByBarcode(code: string) {
    return this.db.query.medicines.findFirst({
      where: and(
        eq(schema.medicines.barcode, code),
        eq(schema.medicines.isActive, true),
        isNull(schema.medicines.deletedAt),
      ),
      with: { category: true },
    });
  }

  async findMedicineByBarcode(barcode: string, excludeId?: string) {
    const conditions = [
      eq(schema.medicines.barcode, barcode),
      isNull(schema.medicines.deletedAt),
    ];
    if (excludeId) conditions.push(ne(schema.medicines.id, excludeId));
    const [medicine] = await this.db
      .select({
        id: schema.medicines.id,
        name: schema.medicines.name,
        sku: schema.medicines.sku,
      })
      .from(schema.medicines)
      .where(and(...conditions))
      .limit(1);
    return medicine ?? null;
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
          gte(schema.inventoryBatches.expiryDate, sql`CURRENT_DATE`),
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

  async findBarcodeSet(barcodes: string[]): Promise<Set<string>> {
    if (barcodes.length === 0) return new Set();
    const rows = await this.db
      .select({ barcode: schema.medicines.barcode })
      .from(schema.medicines)
      .where(isNull(schema.medicines.deletedAt));
    const existing = new Set(rows.map((r) => r.barcode).filter(Boolean));
    return new Set(barcodes.filter((b) => existing.has(b)));
  }

  /** Highest number already used by an auto-assigned MED##### SKU, so an
   *  import continues the sequence rather than colliding with it. The regex
   *  filter means hand-written SKUs in other shapes (the seeder's MED-001,
   *  supplier codes) are ignored, and it guarantees the strip-prefix cast
   *  below only ever sees digits. Returns 0 when the table has none. */
  async getMaxSequentialSku(): Promise<number> {
    const [row] = await this.db
      .select({
        max: sql<string | null>`max(substring(${schema.medicines.sku} from 4)::bigint)`,
      })
      .from(schema.medicines)
      .where(sql`${schema.medicines.sku} ~ '^MED[0-9]+$'`);
    return Number(row?.max ?? 0);
  }

  /** Map category names to ids for bulk import, creating any that are new.
   *  Returns a lowercase-keyed map so callers can look up case-insensitively.
   *  onConflictDoNothing covers two imports racing on the same new name. */
  async findOrCreateCategoryIds(names: string[]): Promise<Map<string, string>> {
    const wanted = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
    if (wanted.length === 0) return new Map();

    const existing = await this.db
      .select({
        id: schema.medicineCategories.id,
        name: schema.medicineCategories.name,
      })
      .from(schema.medicineCategories);
    const byName = new Map(existing.map((c) => [c.name.toLowerCase(), c.id]));

    const missing = wanted.filter((n) => !byName.has(n.toLowerCase()));
    if (missing.length > 0) {
      await this.db
        .insert(schema.medicineCategories)
        .values(missing.map((name) => ({ name })))
        .onConflictDoNothing();
      const refreshed = await this.db
        .select({
          id: schema.medicineCategories.id,
          name: schema.medicineCategories.name,
        })
        .from(schema.medicineCategories);
      for (const c of refreshed) byName.set(c.name.toLowerCase(), c.id);
    }
    return byName;
  }

  /** Insert medicines and hand back their new ids keyed by SKU, so the caller
   *  can attach the batch rows that came in on the same CSV lines. */
  async bulkCreateMedicines(
    rows: CreateMedicineDto[],
    createdBy?: string,
    tx?: any,
  ): Promise<Map<string, string>> {
    if (rows.length === 0) return new Map();
    const run = async (db: any) => {
      const idsBySku = new Map<string, string>();
      for (const chunk of chunkForColumns(rows, widestRow(rows))) {
        const inserted = await db
          .insert(schema.medicines)
          .values(chunk as any[])
          .returning({ id: schema.medicines.id, sku: schema.medicines.sku });
        for (const m of inserted) idsBySku.set(m.sku, m.id);
      }
      return idsBySku;
    };
    // One transaction across all chunks: a catalogue that fails halfway should
    // not leave half its medicines behind for the next run to trip over.
    return tx ? run(tx) : this.db.transaction(run);
  }

  /** The whole write half of a catalogue import, in a single transaction:
   *  medicines, then the warehouse/location/supplier rows their opening stock
   *  needs, then the batches and ledger entries. Atomic because the alternative
   *  strands medicines in the table with no stock — and since they then look
   *  "already imported", a retry would never load that stock. */
  async persistCatalogueImport(input: {
    medicines: CreateMedicineDto[];
    batches: {
      sku: string;
      locationLabel?: string;
      supplierName?: string;
      batchNo: string;
      manufactureDate?: string;
      expiryDate: string;
      quantity: number;
      costPrice: string;
      mrpAtEntry: string;
    }[];
    branchId?: string;
    userId?: string;
  }): Promise<{ idsBySku: Map<string, string>; batchesCreated: number }> {
    const { medicines, batches, branchId, userId } = input;
    if (medicines.length === 0) return { idsBySku: new Map(), batchesCreated: 0 };

    return this.db.transaction(async (tx) => {
      const idsBySku = await this.bulkCreateMedicines(medicines, userId, tx);

      // Only stock for medicines that actually got inserted.
      const usable = batches.filter((b) => idsBySku.has(b.sku));
      if (usable.length === 0 || !branchId) {
        return { idsBySku, batchesCreated: 0 };
      }

      const [locationIds, supplierIds] = await Promise.all([
        this.findOrCreateLocationIds(
          branchId,
          usable.flatMap((b) => (b.locationLabel ? [b.locationLabel] : [])),
          tx,
        ),
        this.findOrCreateSupplierIds(
          usable.flatMap((b) => (b.supplierName ? [b.supplierName] : [])),
          tx,
        ),
      ]);

      const batchesCreated = await this.bulkCreateBatches(
        usable.map((b) => ({
          medicineId: idsBySku.get(b.sku)!,
          // Imported stock belongs to the branch running the import. Previously
          // this was implied by the shelf it landed on; now it is stated.
          branchId,
          locationId: b.locationLabel
            ? locationIds.get(b.locationLabel.toLowerCase())
            : undefined,
          supplierId: b.supplierName
            ? supplierIds.get(b.supplierName.toLowerCase())
            : undefined,
          batchNo: b.batchNo,
          manufactureDate: b.manufactureDate,
          expiryDate: b.expiryDate,
          quantity: b.quantity,
          costPrice: b.costPrice,
          mrpAtEntry: b.mrpAtEntry,
        })),
        userId,
        tx,
      );
      return { idsBySku, batchesCreated };
    });
  }

  /** Name+manufacturer identity of every live medicine, normalized the same way
   *  the importer normalizes a CSV row. This is what lets a re-import recognise
   *  a product that arrived without a Medicine_ID last time: its SKU was minted,
   *  so the SKU alone can never match on a second run. */
  async findNaturalKeys(): Promise<Set<string>> {
    const rows = await this.db
      .select({
        name: schema.medicines.name,
        manufacturer: schema.medicines.manufacturer,
      })
      .from(schema.medicines)
      .where(isNull(schema.medicines.deletedAt));
    return new Set(rows.map((r) => normalizedIdentity(r.name, r.manufacturer)));
  }

  /** Resolve rack labels ("Rack C-2, Shelf 2") to storage_locations rows in the
   *  given branch, creating the ones that do not exist yet. Keyed
   *  lowercase so callers can look up case-insensitively.
   *
   *  Rack labels repeat across branches — every branch has a "Rack A-1" — so
   *  the lookup is scoped by branch or two branches would share one shelf row. */
  async findOrCreateLocationIds(
    branchId: string,
    labels: string[],
    tx?: any,
  ): Promise<Map<string, string>> {
    const db = tx ?? this.db;
    const wanted = [...new Set(labels.map((l) => l.trim()).filter(Boolean))];
    if (wanted.length === 0) return new Map();

    const existing = await db
      .select({
        id: schema.storageLocations.id,
        label: schema.storageLocations.label,
      })
      .from(schema.storageLocations)
      .where(eq(schema.storageLocations.branchId, branchId));
    const byLabel = new Map<string, string>(
      existing.map((l: { id: string; label: string }) => [l.label.toLowerCase(), l.id]),
    );

    const missing = wanted.filter((l) => !byLabel.has(l.toLowerCase()));
    for (const chunk of chunkForColumns(missing, 5)) {
      const created = await db
        .insert(schema.storageLocations)
        .values(chunk.map((label) => ({ branchId, ...parseLocationLabel(label) })))
        .returning({
          id: schema.storageLocations.id,
          label: schema.storageLocations.label,
        });
      for (const l of created as { id: string; label: string }[]) {
        byLabel.set(l.label.toLowerCase(), l.id);
      }
    }
    return byLabel;
  }

  /** Resolve distributor names to supplier rows, creating the unknown ones.
   *  Imported suppliers carry only a name — phone and GST are filled in later,
   *  which is why suppliers.phone is nullable. */
  async findOrCreateSupplierIds(names: string[], tx?: any): Promise<Map<string, string>> {
    const db = tx ?? this.db;
    const wanted = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
    if (wanted.length === 0) return new Map();

    const existing = await db
      .select({
        id: schema.suppliers.id,
        name: schema.suppliers.name,
        code: schema.suppliers.code,
      })
      .from(schema.suppliers);
    const byName = new Map<string, string>(
      existing.map((s: { id: string; name: string }) => [s.name.toLowerCase(), s.id]),
    );

    const missing = wanted.filter((n) => !byName.has(n.toLowerCase()));
    if (missing.length > 0) {
      const takenCodes = new Set<string>(existing.map((s: { code: string }) => s.code));
      const created = await db
        .insert(schema.suppliers)
        .values(
          missing.map((name) => ({ name, code: uniqueSupplierCode(name, takenCodes) })),
        )
        .onConflictDoNothing()
        .returning({ id: schema.suppliers.id, name: schema.suppliers.name });
      for (const s of created as { id: string; name: string }[]) {
        byName.set(s.name.toLowerCase(), s.id);
      }
    }
    return byName;
  }

  /** Insert opening-stock batches and their matching ledger entries. The
   *  movement rows are what make imported stock show up in movement history
   *  rather than appearing from nowhere. */
  async bulkCreateBatches(
    rows: {
      medicineId: string;
      locationId?: string;
      supplierId?: string;
      batchNo: string;
      manufactureDate?: string;
      expiryDate: string;
      quantity: number;
      costPrice: string;
      mrpAtEntry: string;
    }[],
    performedBy?: string,
    tx?: any,
  ): Promise<number> {
    if (rows.length === 0) return 0;
    const today = new Date().toISOString().slice(0, 10);
    const withStatus = rows.map((r) => ({
      ...r,
      // A catalogue can list stock that already expired or sold out. Landing
      // those as "active" would inflate stock value and show them as on-hand
      // until the nightly expiry job happened to run.
      status:
        r.expiryDate < today
          ? ("expired" as const)
          : r.quantity <= 0
            ? ("depleted" as const)
            : ("active" as const),
    }));

    const run = async (db: any) => {
      let count = 0;
      for (const chunk of chunkForColumns(withStatus, widestRow(withStatus))) {
        const inserted = await db
          .insert(schema.inventoryBatches)
          .values(chunk)
          .returning({
            id: schema.inventoryBatches.id,
            medicineId: schema.inventoryBatches.medicineId,
            quantity: schema.inventoryBatches.quantity,
          });
        count += inserted.length;

        const movements = (inserted as { id: string; medicineId: string; quantity: number }[])
          .filter((b) => b.quantity > 0)
          .map((b) => ({
            batchId: b.id,
            medicineId: b.medicineId,
            movementType: "purchase",
            quantity: b.quantity,
            referenceType: "CSV_IMPORT",
            performedBy,
            notes: "Opening stock from catalogue import",
          }));
        for (const mChunk of chunkForColumns(movements, 7)) {
          await db.insert(schema.stockMovements).values(mChunk);
        }
      }
      return count;
    };

    return tx ? run(tx) : this.db.transaction(run);
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
