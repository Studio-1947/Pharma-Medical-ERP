import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  text,
  integer,
  numeric,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { invoiceStatusEnum, paymentModeEnum } from "./enums";
import { medicines, inventoryBatches } from "./inventory";
import { users } from "./auth";

export const patients = pgTable(
  "patients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 20 }).notNull().unique(),
    email: varchar("email", { length: 255 }),
    dateOfBirth: timestamp("date_of_birth", { withTimezone: true }),
    gender: varchar("gender", { length: 20 }),
    address: text("address"),
    allergies: text("allergies").array(),
    bloodGroup: varchar("blood_group", { length: 5 }),
    insuranceId: varchar("insurance_id", { length: 100 }),
    insuranceExpiry: timestamp("insurance_expiry", { withTimezone: true }),
    loyaltyPoints: integer("loyalty_points").notNull().default(0),
    outstandingBalance: numeric("outstanding_balance", {
      precision: 12,
      scale: 2,
    })
      .notNull()
      .default("0"),
    notes: text("notes"),
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
    phoneIdx: index("patients_phone_idx").on(t.phone),
    nameIdx: index("patients_name_idx").on(t.name),
  }),
);

export const salesInvoices = pgTable(
  "sales_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceNo: varchar("invoice_no", { length: 50 }).notNull().unique(),
    patientId: uuid("patient_id").references(() => patients.id, {
      onDelete: "restrict",
    }),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id").notNull(),
    prescriptionId: uuid("prescription_id"),
    subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
    discountAmount: numeric("discount_amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    taxAmount: numeric("tax_amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull(),
    amountPaid: numeric("amount_paid", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    amountDue: numeric("amount_due", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    paymentMode: paymentModeEnum("payment_mode").notNull().default("cash"),
    status: invoiceStatusEnum("status").notNull().default("draft"),
    notes: text("notes"),
    isOfflineSync: boolean("is_offline_sync").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    invoiceNoIdx: index("invoices_invoice_no_idx").on(t.invoiceNo),
    patientIdx: index("invoices_patient_idx").on(t.patientId),
    staffIdx: index("invoices_staff_idx").on(t.staffId),
    createdAtIdx: index("invoices_created_at_idx").on(t.createdAt),
  }),
);

export const salesInvoiceItems = pgTable("sales_invoice_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => salesInvoices.id, { onDelete: "cascade" }),
  medicineId: uuid("medicine_id")
    .notNull()
    .references(() => medicines.id, { onDelete: "restrict" }),
  batchId: uuid("batch_id")
    .notNull()
    .references(() => inventoryBatches.id, { onDelete: "restrict" }),
  quantity: integer("quantity").notNull(),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
  discountPct: numeric("discount_pct", { precision: 5, scale: 2 })
    .notNull()
    .default("0"),
  taxPct: numeric("tax_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  lineTotal: numeric("line_total", { precision: 12, scale: 2 }).notNull(),
});

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => salesInvoices.id, { onDelete: "restrict" }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  mode: paymentModeEnum("mode").notNull(),
  referenceNo: varchar("reference_no", { length: 100 }),
  processedBy: uuid("processed_by")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// Relations
export const patientsRelations = relations(patients, ({ many }) => ({
  invoices: many(salesInvoices),
}));

export const salesInvoicesRelations = relations(
  salesInvoices,
  ({ one, many }) => ({
    patient: one(patients, {
      fields: [salesInvoices.patientId],
      references: [patients.id],
    }),
    staff: one(users, {
      fields: [salesInvoices.staffId],
      references: [users.id],
    }),
    items: many(salesInvoiceItems),
    payments: many(payments),
  }),
);

export const salesInvoiceItemsRelations = relations(
  salesInvoiceItems,
  ({ one }) => ({
    invoice: one(salesInvoices, {
      fields: [salesInvoiceItems.invoiceId],
      references: [salesInvoices.id],
    }),
    medicine: one(medicines, {
      fields: [salesInvoiceItems.medicineId],
      references: [medicines.id],
    }),
    batch: one(inventoryBatches, {
      fields: [salesInvoiceItems.batchId],
      references: [inventoryBatches.id],
    }),
  }),
);
