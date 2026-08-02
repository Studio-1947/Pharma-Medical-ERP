import { pgEnum } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", [
  "super_admin",
  "admin",
  "pharmacist",
  "cashier",
  "inventory_manager",
  "distribution_staff",
  "hr_manager",
  "reports_analyst",
  "doctor",
]);

export const tokenStatusEnum = pgEnum("token_status", [
  "pending",
  "called",
  "completed",
  "cancelled",
]);

export const invoiceStatusEnum = pgEnum("invoice_status", [
  "draft",
  "confirmed",
  "paid",
  "partially_paid",
  "refunded",
  "cancelled",
]);

export const paymentModeEnum = pgEnum("payment_mode", [
  "cash",
  "card",
  "upi",
  "insurance",
  "credit",
  "mixed",
]);

export const batchStatusEnum = pgEnum("batch_status", [
  "active",
  "quarantine",
  "expired",
  "depleted",
  "recalled",
]);

export const poStatusEnum = pgEnum("po_status", [
  "draft",
  "pending_approval",
  "approved",
  "sent",
  "partially_received",
  "received",
  "cancelled",
]);

export const prescriptionStatusEnum = pgEnum("prescription_status", [
  "pending_verification",
  "verified",
  "partially_dispensed",
  "fully_dispensed",
  "expired",
  "rejected",
]);

export const transferStatusEnum = pgEnum("transfer_status", [
  "draft",
  "in_transit",
  "delivered",
  "rejected",
]);

export const attendanceStatusEnum = pgEnum("attendance_status", [
  "present",
  "absent",
  "half_day",
  "on_leave",
  "holiday",
]);

export const leaveStatusEnum = pgEnum("leave_status", [
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);

export const supplierPaymentMethodEnum = pgEnum("supplier_payment_method", [
  "cash",
  "bank_transfer",
  "cheque",
  "upi",
  "other",
]);

export const supplierPaymentTypeEnum = pgEnum("supplier_payment_type", [
  "payment",
  "credit_note",
]);

export const supplierReturnReasonEnum = pgEnum("supplier_return_reason", [
  "expiry",
  "damage",
  "other",
]);

export const supplierReturnOutcomeEnum = pgEnum("supplier_return_outcome", [
  "pending",
  "replacement",
  "credit_note",
]);
