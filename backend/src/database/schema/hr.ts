import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  text,
  integer,
  numeric,
  boolean,
  date,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { attendanceStatusEnum, leaveStatusEnum } from "./enums";
import { users } from "./auth";

export const departments = pgTable("departments", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  branchId: uuid("branch_id").notNull(),
  managerId: uuid("manager_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const employees = pgTable("employees", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id").notNull(),
  departmentId: uuid("department_id").references(() => departments.id, {
    onDelete: "set null",
  }),
  employeeCode: varchar("employee_code", { length: 50 }).notNull().unique(),
  firstName: varchar("first_name", { length: 100 }).notNull(),
  lastName: varchar("last_name", { length: 100 }).notNull(),
  phone: varchar("phone", { length: 20 }),
  address: text("address"),
  dateOfBirth: date("date_of_birth"),
  hireDate: date("hire_date").notNull(),
  designation: varchar("designation", { length: 100 }),
  licenseNo: varchar("license_no", { length: 100 }),
  licenseExpiry: date("license_expiry"),
  baseSalary: numeric("base_salary", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  isActive: boolean("is_active").notNull().default(true),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const attendance = pgTable("attendance", {
  id: uuid("id").primaryKey().defaultRandom(),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  checkIn: timestamp("check_in", { withTimezone: true }),
  checkOut: timestamp("check_out", { withTimezone: true }),
  status: attendanceStatusEnum("status").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const leaveRequests = pgTable("leave_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  leaveType: varchar("leave_type", { length: 50 }).notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  days: integer("days").notNull(),
  reason: text("reason").notNull(),
  status: leaveStatusEnum("status").notNull().default("pending"),
  reviewedBy: uuid("reviewed_by").references(() => users.id, {
    onDelete: "set null",
  }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const shifts = pgTable("shifts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  branchId: uuid("branch_id").notNull(),
  startTime: varchar("start_time", { length: 5 }).notNull(),
  endTime: varchar("end_time", { length: 5 }).notNull(),
  daysOfWeek: integer("days_of_week").array().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// Relations
export const employeesRelations = relations(employees, ({ one, many }) => ({
  user: one(users, { fields: [employees.userId], references: [users.id] }),
  department: one(departments, {
    fields: [employees.departmentId],
    references: [departments.id],
  }),
  attendance: many(attendance),
  leaveRequests: many(leaveRequests),
}));
export const departmentsRelations = relations(departments, ({ one, many }) => ({
  manager: one(users, {
    fields: [departments.managerId],
    references: [users.id],
  }),
  employees: many(employees),
}));

export const attendanceRelations = relations(attendance, ({ one }) => ({
  employee: one(employees, {
    fields: [attendance.employeeId],
    references: [employees.id],
  }),
}));

export const leaveRequestsRelations = relations(leaveRequests, ({ one }) => ({
  employee: one(employees, {
    fields: [leaveRequests.employeeId],
    references: [employees.id],
  }),
  reviewer: one(users, {
    fields: [leaveRequests.reviewedBy],
    references: [users.id],
  }),
}));

export const shiftsRelations = relations(shifts, ({ many }) => ({
  // Shifts might be linked to employees through a join table later, 
  // but for now let's just define the object if needed.
}));
