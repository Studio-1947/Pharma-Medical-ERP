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
  uniqueIndex,
  date,
  primaryKey,
  AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { invoiceStatusEnum, paymentModeEnum } from "./enums";
import { medicines, inventoryBatches } from "./inventory";
import { branches } from "./branches";
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
    state: varchar("state", { length: 100 }),
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
    // Mandatory: revenue that cannot name its branch breaks per-branch sales
    // reporting and the GST return, which is filed per branch registration.
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    prescriptionId: uuid("prescription_id"),
    /**
     * The doctor a sale is credited to when no prescription carries that link.
     *
     * A counter sale is often still a doctor's sale: the patient was seen
     * upstairs, walked down without the paper, and asked for what they were
     * told to take. Left untagged, that medicine reads as anonymous OTC and the
     * doctor's own dispensing history is missing exactly the sales the clinic
     * generated. Nullable and purely informational — it is an attribution, not
     * a prescription, and it never satisfies the Schedule H gate, which still
     * demands a real prescription or a manager's attestation.
     *
     * `set null` on delete: losing the doctor's account must not take the
     * invoice with it — the sale happened either way.
     */
    referredByDoctorId: uuid("referred_by_doctor_id").references(() => users.id, {
      onDelete: "set null",
    }),
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
    isReturn: boolean("is_return").notNull().default(false),
    originalInvoiceId: uuid("original_invoice_id").references(
      (): AnyPgColumn => salesInvoices.id,
      { onDelete: "restrict" }
    ),
    overrideReason: text("override_reason"),
    overriddenBy: uuid("overridden_by").references(() => users.id, {
      onDelete: "set null",
    }),
    // A Schedule H sale a manager attested for at the counter — they saw the
    // prescription, the queue was moving, and the paper has not been recorded
    // yet. `overriddenBy` and `overrideReason` say who vouched and why; this
    // flag is what keeps the debt visible until the prescription is actually
    // attached, which clears it and fills prescriptionId. Without it an
    // attested sale is indistinguishable from any other override and nobody
    // ever goes back for the paper.
    rxPending: boolean("rx_pending").notNull().default(false),
    // What the sale did to the patient's loyalty balance. Recorded rather than
    // recomputed because voiding has to put it back exactly, and neither figure
    // survives on the invoice otherwise: the accrual formula could change, and
    // redemption is folded into discountAmount alongside any manual discount,
    // so the two cannot be told apart after the fact.
    // Rows written before this column existed carry 0 and reverse nothing —
    // honest, since what they awarded is genuinely unknown.
    loyaltyPointsEarned: integer("loyalty_points_earned").notNull().default(0),
    loyaltyPointsRedeemed: integer("loyalty_points_redeemed").notNull().default(0),
    /**
     * Caller-supplied idempotency key, unique across all invoices.
     *
     * The offline POS queues a sale locally and replays it when the connection
     * returns, marking the row synced only once the call resolves. If the
     * server committed but the response was lost — dropped connection, timeout,
     * tab closed mid-flight — the queue replayed the same sale and billed it
     * twice, deducting the stock twice and accruing the points twice. The key
     * lets the second attempt find the first invoice instead of writing a new
     * one. Null for callers that do not send one.
     */
    clientRef: varchar("client_ref", { length: 64 }),
    customerGstin: varchar("customer_gstin", { length: 15 }),
    pdfUrl: varchar("pdf_url", { length: 255 }),
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
    branchCreatedAtIdx: index("invoices_branch_created_at_idx").on(
      t.branchId,
      t.createdAt,
    ),
    // "What did this doctor's patients buy, and when" — the only way this
    // column is ever read.
    referringDoctorIdx: index("invoices_referred_by_doctor_idx").on(
      t.referredByDoctorId,
      t.createdAt,
    ),
    // Partial: only rows that carry a key take part, so the many invoices
    // without one do not collide with each other on NULL.
    clientRefUniq: uniqueIndex("invoices_client_ref_uniq")
      .on(t.clientRef)
      .where(sql`${t.clientRef} IS NOT NULL`),
  }),
);

export const salesInvoiceItems = pgTable("sales_invoice_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => salesInvoices.id, { onDelete: "cascade" }),
  // Line kind: "medicine" (stock line, FKs set) or "consultation" (doctor
  // consultation fee — a GST-exempt service line with no medicine/batch).
  itemType: varchar("item_type", { length: 20 }).notNull().default("medicine"),
  // Free-text description for non-medicine lines ("Doctor Consultation — Dr. X").
  itemName: varchar("item_name", { length: 255 }),
  medicineId: uuid("medicine_id").references(() => medicines.id, {
    onDelete: "restrict",
  }),
  batchId: uuid("batch_id").references(() => inventoryBatches.id, {
    onDelete: "restrict",
  }),
  quantity: integer("quantity").notNull(),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
  discountPct: numeric("discount_pct", { precision: 5, scale: 2 })
    .notNull()
    .default("0"),
  taxPct: numeric("tax_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  lineTotal: numeric("line_total", { precision: 12, scale: 2 }).notNull(),
  cgstAmt: numeric("cgst_amt", { precision: 12, scale: 2 }).notNull().default("0"),
  sgstAmt: numeric("sgst_amt", { precision: 12, scale: 2 }).notNull().default("0"),
  igstAmt: numeric("igst_amt", { precision: 12, scale: 2 }).notNull().default("0"),
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
    // Who the sale is credited to clinically, when anyone. Separate from
    // `staff`, who is whoever stood at the till.
    referredByDoctor: one(users, {
      fields: [salesInvoices.referredByDoctorId],
      references: [users.id],
    }),
    items: many(salesInvoiceItems),
    payments: many(payments),
    originalInvoice: one(salesInvoices, {
      fields: [salesInvoices.originalInvoiceId],
      references: [salesInvoices.id],
      relationName: "returns",
    }),
    returnInvoices: many(salesInvoices, { relationName: "returns" }),
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
export const paymentsRelations = relations(payments, ({ one }) => ({
  invoice: one(salesInvoices, {
    fields: [payments.invoiceId],
    references: [salesInvoices.id],
  }),
  processedBy: one(users, {
    fields: [payments.processedBy],
    references: [users.id],
  }),
}));

/**
 * Per-branch, per-day invoice counter.
 *
 * The serial used to come from a Redis INCR keyed by branch and date, with a
 * two-day TTL and nothing in Postgres behind it. That had two failure modes,
 * both of them costly:
 *
 *  - Lose the key — eviction, restart before the RDB snapshot, a flush — and
 *    the counter restarts at 1, re-issuing numbers already used that day. The
 *    unique index on invoice_no then rejects the insert, so billing stops dead
 *    at the counter until the date rolls over.
 *  - The number was handed out before the invoice was written and Redis takes
 *    no part in the transaction, so any later failure inside it — a concurrent
 *    depletion, a bad payment row — consumed a number that nothing recorded.
 *    Rule 46 requires the series to be consecutive, and those gaps could not
 *    be explained after the fact because no trace of them existed.
 *
 * Allocating here instead means the number is durable and rolls back with the
 * sale that failed. The cost is that the row lock serialises checkouts within
 * one branch for the length of the transaction, which is inherent: a gapless
 * series cannot be handed out concurrently.
 */
export const invoiceSequences = pgTable(
  "invoice_sequences",
  {
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    // The series restarts daily and the date is part of the printed number,
    // so it is part of the key rather than a column to reset on a schedule.
    seqDate: date("seq_date").notNull(),
    lastSeq: integer("last_seq").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.branchId, t.seqDate] }),
  }),
);
