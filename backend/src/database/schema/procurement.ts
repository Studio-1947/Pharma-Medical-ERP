import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  text,
  integer,
  numeric,
  date,
  boolean,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import {
  poStatusEnum,
  supplierPaymentMethodEnum,
  supplierPaymentTypeEnum,
  supplierReturnReasonEnum,
  supplierReturnOutcomeEnum,
} from "./enums";
import { medicines, inventoryBatches, warehouses } from "./inventory";
import { users } from "./auth";

export const suppliers = pgTable("suppliers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  contactPerson: varchar("contact_person", { length: 255 }),
  phone: varchar("phone", { length: 20 }).notNull(),
  email: varchar("email", { length: 255 }),
  address: text("address"),
  gstNo: varchar("gst_no", { length: 20 }),
  panNo: varchar("pan_no", { length: 20 }),
  // Drug licence (Form 20B/21B wholesale) — a pharma supplier needs one to
  // legally sell scheduled drugs; expiry is tracked for compliance renewal.
  drugLicenseNo: varchar("drug_license_no", { length: 50 }),
  drugLicenseExpiry: date("drug_license_expiry"),
  creditDays: integer("credit_days").notNull().default(0),
  creditLimit: numeric("credit_limit", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  outstandingBalance: numeric("outstanding_balance", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  rating: integer("rating").default(3),
  isActive: boolean("is_active").notNull().default(true),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const purchaseOrders = pgTable("purchase_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  poNumber: varchar("po_number", { length: 50 }).notNull().unique(),
  supplierId: uuid("supplier_id")
    .notNull()
    .references(() => suppliers.id, { onDelete: "restrict" }),
  warehouseId: uuid("warehouse_id")
    .notNull()
    .references(() => warehouses.id, { onDelete: "restrict" }),
  raisedBy: uuid("raised_by")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  approvedBy: uuid("approved_by").references(() => users.id, {
    onDelete: "set null",
  }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  status: poStatusEnum("status").notNull().default("draft"),
  expectedDelivery: date("expected_delivery"),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  taxAmount: numeric("tax_amount", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  totalValue: numeric("total_value", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  notes: text("notes"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const purchaseOrderItems = pgTable("purchase_order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  poId: uuid("po_id")
    .notNull()
    .references(() => purchaseOrders.id, { onDelete: "cascade" }),
  medicineId: uuid("medicine_id")
    .notNull()
    .references(() => medicines.id, { onDelete: "restrict" }),
  orderedQty: integer("ordered_qty").notNull(),
  receivedQty: integer("received_qty").notNull().default(0),
  unitCost: numeric("unit_cost", { precision: 12, scale: 2 }).notNull(),
  taxPct: numeric("tax_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  // Free units the supplier throws in on top of orderedQty for a scheme like
  // "10+1" (order 10, get an 11th free) — not billed.
  schemeFreeQty: integer("scheme_free_qty").notNull().default(0),
  // Straight rate discount off unitCost, e.g. 0 / 3 / 5 (%).
  discountPct: numeric("discount_pct", { precision: 5, scale: 2 })
    .notNull()
    .default("0"),
  // Consignment: only payable once actually sold, not on delivery.
  isConsignment: boolean("is_consignment").notNull().default(false),
  lineTotal: numeric("line_total", { precision: 12, scale: 2 }).notNull(),
});

export const goodsReceivedNotes = pgTable("goods_received_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  grnNumber: varchar("grn_number", { length: 50 }).notNull().unique(),
  poId: uuid("po_id")
    .notNull()
    .references(() => purchaseOrders.id, { onDelete: "restrict" }),
  receivedBy: uuid("received_by")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  supplierInvoiceNo: varchar("supplier_invoice_no", { length: 100 }),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  qcPassed: boolean("qc_passed").notNull().default(false),
  qcNotes: text("qc_notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const grnItems = pgTable("grn_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  grnId: uuid("grn_id")
    .notNull()
    .references(() => goodsReceivedNotes.id, { onDelete: "cascade" }),
  poItemId: uuid("po_item_id")
    .notNull()
    .references(() => purchaseOrderItems.id, { onDelete: "restrict" }),
  batchId: uuid("batch_id").references(() => inventoryBatches.id, {
    onDelete: "set null",
  }),
  receivedQty: integer("received_qty").notNull(),
  rejectedQty: integer("rejected_qty").notNull().default(0),
  // How many of receivedQty on THIS delivery were free (scheme), not billed.
  freeQty: integer("free_qty").notNull().default(0),
  batchNo: varchar("batch_no", { length: 100 }).notNull(),
  expiryDate: date("expiry_date").notNull(),
});

export const supplierPayments = pgTable("supplier_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  supplierId: uuid("supplier_id")
    .notNull()
    .references(() => suppliers.id, { onDelete: "restrict" }),
  // Bill this payment settles; null = general "on account" payment not tied
  // to one delivery.
  grnId: uuid("grn_id").references(() => goodsReceivedNotes.id, {
    onDelete: "set null",
  }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  // Nullable: a credit note has no cash payment method.
  method: supplierPaymentMethodEnum("method"),
  type: supplierPaymentTypeEnum("type").notNull().default("payment"),
  referenceNo: varchar("reference_no", { length: 100 }),
  paidAt: timestamp("paid_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  paidBy: uuid("paid_by")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const supplierReturns = pgTable("supplier_returns", {
  id: uuid("id").primaryKey().defaultRandom(),
  // The expired/damaged batch — already carries its own grnId/poId, so the
  // batch alone is enough to trace back to the exact supplier and bill.
  batchId: uuid("batch_id")
    .notNull()
    .references(() => inventoryBatches.id, { onDelete: "restrict" }),
  quantity: integer("quantity").notNull(),
  reason: supplierReturnReasonEnum("reason").notNull().default("expiry"),
  outcome: supplierReturnOutcomeEnum("outcome").notNull().default("pending"),
  creditNoteAmount: numeric("credit_note_amount", { precision: 12, scale: 2 }),
  supplierPaymentId: uuid("supplier_payment_id").references(() => supplierPayments.id, {
    onDelete: "set null",
  }),
  replacementBatchId: uuid("replacement_batch_id").references(() => inventoryBatches.id, {
    onDelete: "set null",
  }),
  notes: text("notes"),
  recordedBy: uuid("recorded_by")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// Relations
export const suppliersRelations = relations(suppliers, ({ many }) => ({
  purchaseOrders: many(purchaseOrders),
  payments: many(supplierPayments),
}));

export const purchaseOrdersRelations = relations(
  purchaseOrders,
  ({ one, many }) => ({
    supplier: one(suppliers, {
      fields: [purchaseOrders.supplierId],
      references: [suppliers.id],
    }),
    warehouse: one(warehouses, {
      fields: [purchaseOrders.warehouseId],
      references: [warehouses.id],
    }),
    items: many(purchaseOrderItems),
    grns: many(goodsReceivedNotes),
  }),
);
export const purchaseOrderItemsRelations = relations(
  purchaseOrderItems,
  ({ one }) => ({
    purchaseOrder: one(purchaseOrders, {
      fields: [purchaseOrderItems.poId],
      references: [purchaseOrders.id],
    }),
    medicine: one(medicines, {
      fields: [purchaseOrderItems.medicineId],
      references: [medicines.id],
    }),
  }),
);

export const goodsReceivedNotesRelations = relations(
  goodsReceivedNotes,
  ({ one, many }) => ({
    purchaseOrder: one(purchaseOrders, {
      fields: [goodsReceivedNotes.poId],
      references: [purchaseOrders.id],
    }),
    user: one(users, {
      fields: [goodsReceivedNotes.receivedBy],
      references: [users.id],
    }),
    items: many(grnItems),
    payments: many(supplierPayments),
  }),
);

export const grnItemsRelations = relations(grnItems, ({ one }) => ({
  grn: one(goodsReceivedNotes, {
    fields: [grnItems.grnId],
    references: [goodsReceivedNotes.id],
  }),
  poItem: one(purchaseOrderItems, {
    fields: [grnItems.poItemId],
    references: [purchaseOrderItems.id],
  }),
  batch: one(inventoryBatches, {
    fields: [grnItems.batchId],
    references: [inventoryBatches.id],
  }),
}));

export const supplierPaymentsRelations = relations(
  supplierPayments,
  ({ one }) => ({
    supplier: one(suppliers, {
      fields: [supplierPayments.supplierId],
      references: [suppliers.id],
    }),
    grn: one(goodsReceivedNotes, {
      fields: [supplierPayments.grnId],
      references: [goodsReceivedNotes.id],
    }),
    paidByUser: one(users, {
      fields: [supplierPayments.paidBy],
      references: [users.id],
    }),
  }),
);

export const supplierReturnsRelations = relations(supplierReturns, ({ one }) => ({
  batch: one(inventoryBatches, {
    fields: [supplierReturns.batchId],
    references: [inventoryBatches.id],
    relationName: "returnedBatch",
  }),
  replacementBatch: one(inventoryBatches, {
    fields: [supplierReturns.replacementBatchId],
    references: [inventoryBatches.id],
    relationName: "replacementBatch",
  }),
  supplierPayment: one(supplierPayments, {
    fields: [supplierReturns.supplierPaymentId],
    references: [supplierPayments.id],
  }),
  recordedByUser: one(users, {
    fields: [supplierReturns.recordedBy],
    references: [users.id],
  }),
}));
