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
import { relations } from "drizzle-orm";
import { batchStatusEnum } from "./enums";
import { users } from "./auth";

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
    genericName: varchar("generic_name", { length: 255 }),
    sku: varchar("sku", { length: 100 }).notNull().unique(),
    barcode: varchar("barcode", { length: 100 }),
    categoryId: uuid("category_id").references(() => medicineCategories.id, {
      onDelete: "set null",
    }),
    manufacturer: varchar("manufacturer", { length: 255 }),
    hsnCode: varchar("hsn_code", { length: 20 }),
    unit: varchar("unit", { length: 50 }).notNull().default("strip"),
    stripSize: integer("strip_size").notNull().default(1),
    priceMrp: numeric("price_mrp", { precision: 12, scale: 2 }).notNull(),
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
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
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
    skuIdx: uniqueIndex("medicines_sku_idx").on(t.sku),
    barcodeIdx: index("medicines_barcode_idx").on(t.barcode),
  }),
);

export const warehouses = pgTable("warehouses", {
  id: uuid("id").primaryKey().defaultRandom(),
  branchId: uuid("branch_id").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  code: varchar("code", { length: 20 }).notNull().unique(),
  address: text("address"),
  isDefault: boolean("is_default").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const storageLocations = pgTable("storage_locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  warehouseId: uuid("warehouse_id")
    .notNull()
    .references(() => warehouses.id, { onDelete: "cascade" }),
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
    locationId: uuid("location_id").references(() => storageLocations.id, {
      onDelete: "set null",
    }),
    batchNo: varchar("batch_no", { length: 100 }).notNull(),
    expiryDate: date("expiry_date").notNull(),
    quantity: integer("quantity").notNull().default(0),
    reservedQty: integer("reserved_qty").notNull().default(0),
    costPrice: numeric("cost_price", { precision: 12, scale: 2 }).notNull(),
    mrpAtEntry: numeric("mrp_at_entry", { precision: 12, scale: 2 }).notNull(),
    status: batchStatusEnum("status").notNull().default("active"),
    poId: uuid("po_id"),
    grnId: uuid("grn_id"),
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
    medicineBatchNoUniq: uniqueIndex("batch_medicine_batchno_uniq").on(
      t.medicineId,
      t.batchNo,
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
    warehouse: one(warehouses, {
      fields: [storageLocations.warehouseId],
      references: [warehouses.id],
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

export const systemAlerts = pgTable("system_alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: varchar("type", { length: 50 }).notNull(), // 'EXPIRY', 'REORDER', 'SYSTEM'
  message: text("message").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  referenceId: uuid("reference_id"), // medicineId, batchId, etc.
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

