import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  text,
  integer,
  boolean,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { transferStatusEnum } from "./enums";
import { medicines, inventoryBatches, warehouses } from "./inventory";
import { users } from "./auth";

export const branches = pgTable("branches", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 20 }).notNull().unique(),
  address: text("address").notNull(),
  phone: varchar("phone", { length: 20 }),
  email: varchar("email", { length: 255 }),
  isHeadOffice: boolean("is_head_office").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const stockTransfers = pgTable("stock_transfers", {
  id: uuid("id").primaryKey().defaultRandom(),
  transferNo: varchar("transfer_no", { length: 50 }).notNull().unique(),
  fromWarehouseId: uuid("from_warehouse_id")
    .notNull()
    .references(() => warehouses.id),
  toWarehouseId: uuid("to_warehouse_id")
    .notNull()
    .references(() => warehouses.id),
  initiatedBy: uuid("initiated_by")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  approvedBy: uuid("approved_by").references(() => users.id, {
    onDelete: "set null",
  }),
  status: transferStatusEnum("status").notNull().default("draft"),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  notes: text("notes"),
  podFileUrl: text("pod_file_url"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const stockTransferItems = pgTable("stock_transfer_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  transferId: uuid("transfer_id")
    .notNull()
    .references(() => stockTransfers.id, { onDelete: "cascade" }),
  medicineId: uuid("medicine_id")
    .notNull()
    .references(() => medicines.id, { onDelete: "restrict" }),
  batchId: uuid("batch_id")
    .notNull()
    .references(() => inventoryBatches.id, { onDelete: "restrict" }),
  requestedQty: integer("requested_qty").notNull(),
  sentQty: integer("sent_qty").notNull().default(0),
  receivedQty: integer("received_qty").notNull().default(0),
  rejectedQty: integer("rejected_qty").notNull().default(0),
  notes: text("notes"),
});

// Relations
export const stockTransfersRelations = relations(
  stockTransfers,
  ({ one, many }) => ({
    fromWarehouse: one(warehouses, {
      fields: [stockTransfers.fromWarehouseId],
      references: [warehouses.id],
    }),
    toWarehouse: one(warehouses, {
      fields: [stockTransfers.toWarehouseId],
      references: [warehouses.id],
    }),
    items: many(stockTransferItems),
  }),
);
