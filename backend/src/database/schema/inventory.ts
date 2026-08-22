import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  text,
  integer,
  numeric,
  date,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { batchStatusEnum } from "./enums";
import { users } from "./auth";
import { branches } from "./branches";

export const medicineCategories = pgTable("medicine_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  description: text("description"),
  parentId: uuid("parent_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const medicines = pgTable(
  "medicines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    // Marketed brand ("Dolo") as distinct from the full catalogue name
    // ("Dolo 650 mg Tablet"). Staff search by brand at the counter.
    brandName: varchar("brand_name", { length: 255 }),
    // text, not varchar(255): multi-ingredient nutraceuticals run past 350 chars.
    genericName: text("generic_name"),
    // Full ingredient list with per-ingredient amounts, e.g.
    // "Amoxicillin 500 mg + Clavulanic Acid 125 mg". Same length problem.
    composition: text("composition"),
    // Headline strength as printed on the pack ("650 mg", "50 mg/500 mg").
    strength: text("strength"),
    // Tablet | Injection | Syrup | Cream | ... — free text, not an enum: the
    // supplier catalogues use ~60 spellings and new forms appear constantly.
    dosageForm: varchar("dosage_form", { length: 50 }),
    // Raw pack label as sold ("10x10 Tablets", "1 Prefilled Syringe").
    // stripSize stays the numeric field billing divides by.
    packSize: varchar("pack_size", { length: 50 }),
    sku: varchar("sku", { length: 100 }).notNull().unique(),
    barcode: varchar("barcode", { length: 100 }),
    categoryId: uuid("category_id").references(() => medicineCategories.id, {
      onDelete: "set null",
    }),
    // Pharmacological class ("Cephalosporin Antibiotic"), narrower than the
    // shelf-level category ("Antibiotics") that categoryId points at.
    therapeuticClass: varchar("therapeutic_class", { length: 100 }),
    manufacturer: varchar("manufacturer", { length: 255 }),
    hsnCode: varchar("hsn_code", { length: 20 }),
    unit: varchar("unit", { length: 50 }).notNull().default("strip"),
    stripSize: integer("strip_size").notNull().default(1),
    priceMrp: numeric("price_mrp", { precision: 12, scale: 2 }).notNull(),
    // Catalogue/list cost from the supplier. Nullable and advisory only —
    // inventory_batches.cost_price is the figure that values actual stock.
    purchaseRate: numeric("purchase_rate", { precision: 12, scale: 2 }),
    taxPercent: numeric("tax_percent", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    reorderLevel: integer("reorder_level").notNull().default(10),
    reorderQty: integer("reorder_qty").notNull().default(50),
    requiresPrescription: boolean("requires_prescription")
      .notNull()
      .default(false),
    isControlled: boolean("is_controlled").notNull().default(false),
    scheduleClass: varchar("schedule_class", { length: 10 }),
    storageConditions: varchar("storage_conditions", { length: 100 }),
    // Physical drawer/pigeonhole label for counter pick-up. Distinct from the
    // batch's storage_locations row, which is warehouse rack addressing.
    drawerMapping: varchar("drawer_mapping", { length: 50 }),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    /**
     * Every searchable field of the row, folded into one column so the counter
     * search can be a single indexed predicate instead of thirteen ILIKEs.
     *
     * Held twice: the lower-cased text, then the same text with punctuation
     * stripped. That is what lets "pan-40", "pan 40" and "pan40" be one query
     * without a second pass over a second expression.
     *
     * The GIN trigram index that makes this fast lives in the migration, not
     * here: drizzle cannot express the gin_trgm_ops operator class. Dropping
     * `medicines_search_trgm_idx` silently returns the search to a sequential
     * scan — measured at 140ms against 6,795 rows, and it grows with the table.
     */
    searchText: text("search_text").generatedAlwaysAs(
      sql`lower(coalesce("name",'') || ' ' || coalesce("brand_name",'') || ' ' || coalesce("generic_name",'') || ' ' || coalesce("composition",'') || ' ' || coalesce("manufacturer",'') || ' ' || coalesce("sku",'') || ' ' || coalesce("barcode",'') || ' ' || coalesce("strength",'') || ' ' || coalesce("dosage_form",'') || ' ' || coalesce("therapeutic_class",'') || ' ' || coalesce("pack_size",'') || ' ' || coalesce("hsn_code",'') || ' ' || coalesce("drawer_mapping",'')) || ' ' || regexp_replace(lower(coalesce("name",'') || ' ' || coalesce("brand_name",'') || ' ' || coalesce("generic_name",'') || ' ' || coalesce("composition",'') || ' ' || coalesce("manufacturer",'') || ' ' || coalesce("sku",'') || ' ' || coalesce("barcode",'') || ' ' || coalesce("strength",'') || ' ' || coalesce("dosage_form",'') || ' ' || coalesce("therapeutic_class",'') || ' ' || coalesce("pack_size",'') || ' ' || coalesce("hsn_code",'') || ' ' || coalesce("drawer_mapping",'')), '[^a-z0-9]', '', 'g')`,
    ),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    nameIdx: index("medicines_name_idx").on(t.name),
    brandNameIdx: index("medicines_brand_name_idx").on(t.brandName),
    skuIdx: uniqueIndex("medicines_sku_idx").on(t.sku),
    // Partial unique: one live medicine per barcode. NULL barcodes are exempt
    // (many medicines have none), and soft-deleted rows free their barcode.
    barcodeIdx: uniqueIndex("medicines_barcode_unique")
      .on(t.barcode)
      .where(sql`${t.barcode} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    // POS/counter type-ahead: every search is ILIKE '%term%' across these
    // columns, which a plain btree cannot serve. The GIN trigram index makes
    // the substring match index-assisted instead of a full-table scan + regex
    // pass. Requires the pg_trgm extension (created in the migration).
    searchTrgmIdx: index("medicines_search_trgm_idx").using(
      "gin",
      sql`${t.name} gin_trgm_ops, ${t.brandName} gin_trgm_ops, ${t.genericName} gin_trgm_ops, ${t.composition} gin_trgm_ops, ${t.manufacturer} gin_trgm_ops, ${t.sku} gin_trgm_ops, ${t.barcode} gin_trgm_ops`,
    ),
  }),
);

/**
 * Physical shelf addressing inside a branch (rack, shelf, cold chain).
 *
 * Previously hung off a `warehouses` table sitting between branch and shelf.
 * That layer did not exist in the business — there are branches and there are
 * racks — so it was removed and these re-parented straight onto the branch.
 */
export const storageLocations = pgTable("storage_locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => branches.id, { onDelete: "cascade" }),
  aisle: varchar("aisle", { length: 10 }),
  shelf: varchar("shelf", { length: 10 }),
  bin: varchar("bin", { length: 10 }),
  label: varchar("label", { length: 50 }).notNull(),
  isRefrigerated: boolean("is_refrigerated").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const inventoryBatches = pgTable(
  "inventory_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    medicineId: uuid("medicine_id")
      .notNull()
      .references(() => medicines.id, { onDelete: "restrict" }),
    // Which branch physically holds this stock. Denormalised on purpose: the
    // branch used to be reachable only as batch -> location -> warehouse ->
    // branch, and `locationId` is nullable, so any batch without a shelf
    // assigned belonged to no branch at all. Every stock query filters on this.
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    locationId: uuid("location_id").references(() => storageLocations.id, {
      onDelete: "set null",
    }),
    batchNo: varchar("batch_no", { length: 100 }).notNull(),
    // Nullable: printed on most Indian packs but absent from older supplier
    // records, and never required to sell — only expiryDate gates dispensing.
    manufactureDate: date("manufacture_date"),
    expiryDate: date("expiry_date").notNull(),
    quantity: integer("quantity").notNull().default(0),
    reservedQty: integer("reserved_qty").notNull().default(0),
    costPrice: numeric("cost_price", { precision: 12, scale: 2 }).notNull(),
    mrpAtEntry: numeric("mrp_at_entry", { precision: 12, scale: 2 }).notNull(),
    status: batchStatusEnum("status").notNull().default("active"),
    poId: uuid("po_id"),
    grnId: uuid("grn_id"),
    // Distributor this stock came from. Normally reachable by joining through
    // poId, but opening stock loaded from a catalogue import has no purchase
    // order behind it and would otherwise lose its source entirely.
    // No FK reference() here: suppliers is defined in procurement.ts, which
    // already imports this file, and a back-reference would cycle.
    supplierId: uuid("supplier_id"),
    // Copied from the PO item at receipt time so consignment queries never
    // need to re-join through the PO.
    isConsignment: boolean("is_consignment").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    medicineExpiryIdx: index("batch_medicine_expiry_idx").on(
      t.medicineId,
      t.expiryDate,
    ),
    statusIdx: index("batch_status_idx").on(t.status),
    // Per-branch stock lookups and expiry sweeps, the two hottest queries.
    branchMedicineIdx: index("batch_branch_medicine_idx").on(
      t.branchId,
      t.medicineId,
    ),
    branchExpiryIdx: index("batch_branch_expiry_idx").on(
      t.branchId,
      t.expiryDate,
    ),
    // Scoped by branch. Was (medicineId, batchNo) globally, which made branch
    // separation impossible: two branches buying the same drug from the same
    // distributor receive the identical manufacturer batch number, and the
    // second branch's GRN died on a duplicate key.
    medicineBatchNoUniq: uniqueIndex("batch_medicine_batchno_branch_uniq").on(
      t.medicineId,
      t.batchNo,
      t.branchId,
    ),
    fefoAllocationIdx: index("batch_fefo_allocation_idx").on(
      t.medicineId,
      t.branchId,
      t.expiryDate,
      t.quantity,
    ),
  }),
);

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => inventoryBatches.id, { onDelete: "restrict" }),
    medicineId: uuid("medicine_id")
      .notNull()
      .references(() => medicines.id, { onDelete: "restrict" }),
    // Carried on the ledger row itself rather than derived through the batch:
    // per-branch movement reports are a hot path and would otherwise need a
    // three-table join on an append-only table that grows fastest of all.
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    movementType: varchar("movement_type", { length: 50 }).notNull(),
    quantity: integer("quantity").notNull(),
    referenceId: uuid("reference_id"),
    referenceType: varchar("reference_type", { length: 50 }),
    performedBy: uuid("performed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    batchIdx: index("stock_movement_batch_idx").on(t.batchId),
    createdAtIdx: index("stock_movement_created_at_idx").on(t.createdAt),
    branchCreatedAtIdx: index("stock_movement_branch_created_at_idx").on(
      t.branchId,
      t.createdAt,
    ),
  }),
);

// Relations
export const medicineCategoriesRelations = relations(
  medicineCategories,
  ({ many }) => ({ medicines: many(medicines) }),
);

export const medicinesRelations = relations(medicines, ({ one, many }) => ({
  category: one(medicineCategories, {
    fields: [medicines.categoryId],
    references: [medicineCategories.id],
  }),
  batches: many(inventoryBatches),
  stockMovements: many(stockMovements),
}));

export const inventoryBatchesRelations = relations(
  inventoryBatches,
  ({ one, many }) => ({
    medicine: one(medicines, {
      fields: [inventoryBatches.medicineId],
      references: [medicines.id],
    }),
    branch: one(branches, {
      fields: [inventoryBatches.branchId],
      references: [branches.id],
    }),
    location: one(storageLocations, {
      fields: [inventoryBatches.locationId],
      references: [storageLocations.id],
    }),
    stockMovements: many(stockMovements),
  }),
);
export const storageLocationsRelations = relations(
  storageLocations,
  ({ one, many }) => ({
    branch: one(branches, {
      fields: [storageLocations.branchId],
      references: [branches.id],
    }),
    batches: many(inventoryBatches),
  }),
);

export const stockMovementsRelations = relations(stockMovements, ({ one }) => ({
  batch: one(inventoryBatches, {
    fields: [stockMovements.batchId],
    references: [inventoryBatches.id],
  }),
  medicine: one(medicines, {
    fields: [stockMovements.medicineId],
    references: [medicines.id],
  }),
  user: one(users, {
    fields: [stockMovements.performedBy],
    references: [users.id],
  }),
}));

export const systemAlerts = pgTable(
  "system_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: varchar("type", { length: 50 }).notNull(), // 'EXPIRY', 'REORDER', 'SYSTEM'
    message: text("message").notNull(),
    isRead: boolean("is_read").notNull().default(false),
    referenceId: uuid("reference_id"), // medicineId, batchId, etc.
    // Branch the alert concerns. Nullable on purpose: a genuinely system-wide
    // alert ('SYSTEM') belongs to no branch and should reach everyone, whereas
    // stock alerts are only actionable by the branch holding the stock.
    branchId: uuid("branch_id").references(() => branches.id, {
      onDelete: "cascade",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    branchUnreadIdx: index("system_alerts_branch_unread_idx").on(
      t.branchId,
      t.isRead,
    ),
    // Keeps a nightly job from re-raising the same alert every night: while an
    // alert is still unread it is a no-op, and once dismissed the next scan may
    // legitimately raise it again.
    openAlertUniq: uniqueIndex("system_alerts_open_uniq")
      .on(t.type, t.referenceId, t.branchId)
      .where(sql`${t.isRead} = false AND ${t.referenceId} IS NOT NULL`),
  }),
);

