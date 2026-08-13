export const UserRole = {
  SUPER_ADMIN: "super_admin",
  ADMIN: "admin",
  SHOP_MANAGER: "shop_manager",
  DOCTOR: "doctor",
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const InvoiceStatus = {
  DRAFT: "draft",
  CONFIRMED: "confirmed",
  PAID: "paid",
  PARTIALLY_PAID: "partially_paid",
  REFUNDED: "refunded",
  CANCELLED: "cancelled",
} as const;
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

export const PaymentMode = {
  CASH: "cash",
  CARD: "card",
  UPI: "upi",
  INSURANCE: "insurance",
  CREDIT: "credit",
  MIXED: "mixed",
} as const;
export type PaymentMode = (typeof PaymentMode)[keyof typeof PaymentMode];

export const BatchStatus = {
  ACTIVE: "active",
  QUARANTINE: "quarantine",
  EXPIRED: "expired",
  DEPLETED: "depleted",
  RECALLED: "recalled",
} as const;
export type BatchStatus = (typeof BatchStatus)[keyof typeof BatchStatus];

export const PoStatus = {
  DRAFT: "draft",
  PENDING_APPROVAL: "pending_approval",
  APPROVED: "approved",
  SENT: "sent",
  PARTIALLY_RECEIVED: "partially_received",
  RECEIVED: "received",
  CANCELLED: "cancelled",
} as const;
export type PoStatus = (typeof PoStatus)[keyof typeof PoStatus];

export const PrescriptionStatus = {
  PENDING_VERIFICATION: "pending_verification",
  VERIFIED: "verified",
  PARTIALLY_DISPENSED: "partially_dispensed",
  FULLY_DISPENSED: "fully_dispensed",
  EXPIRED: "expired",
  REJECTED: "rejected",
} as const;
export type PrescriptionStatus =
  (typeof PrescriptionStatus)[keyof typeof PrescriptionStatus];

export const TransferStatus = {
  DRAFT: "draft",
  IN_TRANSIT: "in_transit",
  DELIVERED: "delivered",
  REJECTED: "rejected",
} as const;
export type TransferStatus =
  (typeof TransferStatus)[keyof typeof TransferStatus];

export const AttendanceStatus = {
  PRESENT: "present",
  ABSENT: "absent",
  HALF_DAY: "half_day",
  ON_LEAVE: "on_leave",
  HOLIDAY: "holiday",
} as const;
export type AttendanceStatus =
  (typeof AttendanceStatus)[keyof typeof AttendanceStatus];

export const LeaveStatus = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
} as const;
export type LeaveStatus = (typeof LeaveStatus)[keyof typeof LeaveStatus];

export const TokenStatus = {
  PENDING: "pending",
  CALLED: "called",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
} as const;
export type TokenStatus = (typeof TokenStatus)[keyof typeof TokenStatus];
