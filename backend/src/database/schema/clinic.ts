import {
  pgTable,
  uuid,
  integer,
  timestamp,
  text,
  date,
  varchar,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tokenStatusEnum } from "./enums";
import { patients } from "./billing";
import { branches } from "./branches";
import { users } from "./auth";
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
