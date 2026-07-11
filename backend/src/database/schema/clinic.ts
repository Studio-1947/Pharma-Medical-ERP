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
import { relations } from "drizzle-orm";
import { tokenStatusEnum } from "./enums";
import { patients } from "./billing";
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
    date: date("date").notNull(),
    timeSlot: varchar("time_slot", { length: 50 }),
    status: tokenStatusEnum("status").notNull().default("pending"),
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
    doctorDateIdx: index("clinic_tokens_doctor_date_idx").on(t.doctorId, t.date),
    patientIdx: index("clinic_tokens_patient_idx").on(t.patientId),
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
