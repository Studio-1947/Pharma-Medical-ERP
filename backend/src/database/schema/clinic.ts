import {
  pgTable,
  uuid,
  integer,
  timestamp,
  text,
  date,
  varchar,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tokenStatusEnum } from "./enums";
import { patients } from "./billing";
import { branches } from "./branches";
import { users } from "./auth";
import { medicines } from "./inventory";
import { prescriptions } from "./prescriptions";

export const clinicTokens = pgTable(
  "clinic_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenNo: integer("token_no").notNull(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // A token is issued at a branch and belongs to that branch's queue. Was
    // nullable while the column was being introduced; every row has since been
    // backfilled, so the "null branch is visible to super_admin alone" special
    // case is gone and reads no longer have to reason about it.
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    date: date("date").notNull(),
    timeSlot: varchar("time_slot", { length: 50 }),
    // "new" = fresh consultation where the doctor may prescribe medicines;
    // "follow_up" = repeat visit where prescribing is disabled and the doctor
    // only signs off with notes.
    visitType: varchar("visit_type", { length: 20 }).notNull().default("new"),
    status: tokenStatusEnum("status").notNull().default("pending"),
    // Consultation clock. calledAt is stamped when the doctor calls the patient
    // in, completedAt when the consultation is signed off; the difference is the
    // consultation duration. Stored rather than derived from updatedAt, which is
    // rewritten by any later edit (linking a prescription, adding a note) and so
    // cannot be trusted as a clinical timestamp.
    calledAt: timestamp("called_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    prescriptionId: uuid("prescription_id").references(() => prescriptions.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    doctorDateTokenIdx: uniqueIndex("clinic_tokens_doctor_date_token_idx").on(
      t.doctorId,
      t.date,
      t.tokenNo,
    ),
    // One consultation per doctor per slot. Partial on purpose: `time_slot` is
    // optional (walk-ins have none, and NULLs would not conflict anyway), and a
    // cancelled token must release its slot for someone else to book.
    doctorDateSlotUniq: uniqueIndex("clinic_tokens_doctor_date_slot_uniq")
      .on(t.doctorId, t.date, t.timeSlot)
      .where(sql`${t.timeSlot} IS NOT NULL AND ${t.status} <> 'cancelled'`),
    doctorDateIdx: index("clinic_tokens_doctor_date_idx").on(t.doctorId, t.date),
    patientIdx: index("clinic_tokens_patient_idx").on(t.patientId),
    branchDateIdx: index("clinic_tokens_branch_date_idx").on(t.branchId, t.date),
  }),
);

export const clinicTokensRelations = relations(clinicTokens, ({ one }) => ({
  patient: one(patients, {
    fields: [clinicTokens.patientId],
    references: [patients.id],
  }),
  doctor: one(users, {
    fields: [clinicTokens.doctorId],
    references: [users.id],
  }),
  prescription: one(prescriptions, {
    fields: [clinicTokens.prescriptionId],
    references: [prescriptions.id],
  }),
}));

/**
 * The medicines a doctor keeps on their own list — the set they routinely
 * prescribe, with the dosage they normally write for each.
 *
 * This is a curated shortlist, not a catalogue: every row points at a
 * `medicines` row a store manager already seeded, and nothing here can create
 * catalogue entries. The counter desk reads it to jump straight to what a
 * given doctor works with instead of searching the whole formulary, and the
 * doctor panel uses it as quick-pick when writing a prescription.
 *
 * It carries no branch of its own. A doctor already belongs to a branch via
 * `users.branch_id`, so scoping flows through the doctor; stock is the only
 * branch-dependent part and that is joined from `inventory_batches` at read
 * time against whichever branch is asking.
 *
 * Being on this list is NOT a prescription. Schedule H/H1/X medicines still
 * need a verified prescription before they can be dispensed — the list only
 * makes them faster to find.
 */
export const doctorMedicines = pgTable(
  "doctor_medicines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    medicineId: uuid("medicine_id")
      .notNull()
      .references(() => medicines.id, { onDelete: "cascade" }),
    // How this doctor normally writes the medicine. All optional — a list can
    // be a bare set of medicines — but when present the doctor panel pre-fills
    // the prescription line from them.
    defaultDosage: varchar("default_dosage", { length: 100 }),
    defaultFrequency: varchar("default_frequency", { length: 100 }),
    defaultDuration: varchar("default_duration", { length: 100 }),
    defaultQuantity: integer("default_quantity"),
    notes: text("notes"),
    // Manual ordering so a doctor can pin what they reach for most to the top.
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    // One row per medicine per doctor. Partial on deletedAt so removing a
    // medicine and adding it back later is allowed rather than a constraint
    // violation against the tombstone.
    doctorMedicineUniq: uniqueIndex("doctor_medicines_doctor_medicine_uniq")
      .on(t.doctorId, t.medicineId)
      .where(sql`${t.deletedAt} IS NULL`),
    // Drives the list read: every lookup is "this doctor's list, in order".
    doctorSortIdx: index("doctor_medicines_doctor_sort_idx").on(
      t.doctorId,
      t.sortOrder,
    ),
    medicineIdx: index("doctor_medicines_medicine_idx").on(t.medicineId),
  }),
);

export const doctorMedicinesRelations = relations(doctorMedicines, ({ one }) => ({
  doctor: one(users, {
    fields: [doctorMedicines.doctorId],
    references: [users.id],
  }),
  medicine: one(medicines, {
    fields: [doctorMedicines.medicineId],
    references: [medicines.id],
  }),
}));
