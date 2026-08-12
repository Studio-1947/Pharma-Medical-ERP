import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  text,
  boolean,
  date,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { prescriptionStatusEnum } from "./enums";
import { patients } from "./billing";
import { users } from "./auth";
import { medicines } from "./inventory";
import { branches } from "./branches";

export const prescriptions = pgTable(
  "prescriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id").references(() => branches.id, {
      onDelete: "set null",
    }),
    doctorName: varchar("doctor_name", { length: 255 }).notNull(),
    doctorRegNo: varchar("doctor_reg_no", { length: 100 }),
    hospitalName: varchar("hospital_name", { length: 255 }),
    issuedDate: date("issued_date").notNull(),
    expiryDate: date("expiry_date").notNull(),
    fileUrl: text("file_url"),
    ocrRawText: text("ocr_raw_text"),
    verifiedBy: uuid("verified_by").references(() => users.id, {
      onDelete: "set null",
    }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    status: prescriptionStatusEnum("status")
      .notNull()
      .default("pending_verification"),
    rejectionReason: text("rejection_reason"),
    notes: text("notes"),
    isControlled: boolean("is_controlled").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    statusIdx: index("prescriptions_status_idx").on(t.status),
    expiryDateIdx: index("prescriptions_expiry_date_idx").on(t.expiryDate),
    patientIdIdx: index("prescriptions_patient_id_idx").on(t.patientId),
    branchIdIdx: index("prescriptions_branch_id_idx").on(t.branchId),
  }),
);

export const prescriptionItems = pgTable("prescription_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  prescriptionId: uuid("prescription_id")
    .notNull()
    .references(() => prescriptions.id, { onDelete: "cascade" }),
  medicineId: uuid("medicine_id").references(() => medicines.id, {
    onDelete: "set null",
  }),
  medicineName: varchar("medicine_name", { length: 255 }).notNull(),
  dosage: varchar("dosage", { length: 100 }),
  frequency: varchar("frequency", { length: 100 }),
  duration: varchar("duration", { length: 100 }),
  quantityPrescribed: integer("quantity_prescribed"),
  quantityDispensed: integer("quantity_dispensed").notNull().default(0),
  isFullyDispensed: boolean("is_fully_dispensed").notNull().default(false),
});

export const prescriptionsRelations = relations(
  prescriptions,
  ({ one, many }) => ({
    patient: one(patients, {
      fields: [prescriptions.patientId],
      references: [patients.id],
    }),
    branch: one(branches, {
      fields: [prescriptions.branchId],
      references: [branches.id],
    }),
    verifiedBy: one(users, {
      fields: [prescriptions.verifiedBy],
      references: [users.id],
    }),
    items: many(prescriptionItems),
  }),
);

export const prescriptionItemsRelations = relations(
  prescriptionItems,
  ({ one }) => ({
    prescription: one(prescriptions, {
      fields: [prescriptionItems.prescriptionId],
      references: [prescriptions.id],
    }),
    medicine: one(medicines, {
      fields: [prescriptionItems.medicineId],
      references: [medicines.id],
    }),
  }),
);
