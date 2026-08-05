import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  text,
  integer,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { transferStatusEnum } from "./enums";
import { medicines, inventoryBatches } from "./inventory";
import { branches } from "./branches";
import { users } from "./auth";

// `branches` moved to ./branches so schema files needing a branch FK can import
// it without closing an import cycle through inventory.ts. It is exported from
// the schema barrel, so consumers using `schema.branches` are unaffected.

export const stockTransfers = pgTable("stock_transfers", {
  id: uuid("id").primaryKey().defaultRandom(),
  transferNo: varchar("transfer_no", { length: 50 }).notNull().unique(),
  // Transfers move stock between branches. They used to reference warehouses,
  // which were removed: the business has branches and nothing below them.
  fromBranchId: uuid("from_branch_id")
    .notNull()
    .references(() => branches.id, { onDelete: "restrict" }),
  toBranchId: uuid("to_branch_id")
    .notNull()
    .references(() => branches.id, { onDelete: "restrict" }),
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
  // The source branch's batch. Receiving creates a separate batch row in the
  // destination branch rather than moving this one, so each branch's ledger
  // stays self-contained.
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
    fromBranch: one(branches, {
      fields: [stockTransfers.fromBranchId],
      references: [branches.id],
      relationName: "transferFromBranch",
    }),
    toBranch: one(branches, {
      fields: [stockTransfers.toBranchId],
      references: [branches.id],
      relationName: "transferToBranch",
    }),
    items: many(stockTransferItems),
  }),
);
export const stockTransferItemsRelations = relations(
  stockTransferItems,
  ({ one }) => ({
    transfer: one(stockTransfers, {
      fields: [stockTransferItems.transferId],
      references: [stockTransfers.id],
    }),
    medicine: one(medicines, {
      fields: [stockTransferItems.medicineId],
      references: [medicines.id],
    }),
    batch: one(inventoryBatches, {
      fields: [stockTransferItems.batchId],
      references: [inventoryBatches.id],
    }),
  }),
);
