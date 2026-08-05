"use client";

import { useAuthStore } from "@/stores/auth.store";
import { UserRole } from "@pharmerp/types";

export type Action =
  | "billing.create"
  | "billing.void"
  | "billing.discount.large"
  | "inventory.adjust"
  | "inventory.write"
  | "products.write"
  | "products.delete"
  | "procurement.write"
  | "procurement.receive"
  | "patients.write"
  // Seeing the prescriptions module is not the same as being allowed to sign
  // off on a prescription — a doctor writes them, a pharmacist verifies them —
  // so the two are separate grants. Collapsing them put a verify button in
  // front of doctors that the API rejects with a 403.
  | "prescriptions.view"
  | "prescriptions.verify"
  // Amending a prescription after the fact is a pharmacist/admin correction.
  // A doctor writes a new one instead, matching @Roles on PATCH /prescriptions/:id.
  | "prescriptions.edit"
  | "staff.write"
  | "reports.view"
  | "users.manage"
  | "branches.manage"
  | "distribution.write"
  | "clinic.tokens"
  | "clinic.doctor"
  // The only super_admin-exclusive grant. Every other Action is held by both
  // SUPER_ADMIN and ADMIN, whose arrays are otherwise identical — which is why
  // there was no way to gate a route to super_admin alone before this.
  | "admin.console";

const ROLE_PERMISSIONS: Record<UserRole, Action[]> = {
  [UserRole.SUPER_ADMIN]: [
    "billing.create", "billing.void", "billing.discount.large",
    "inventory.adjust", "inventory.write", "products.write", "products.delete",
    "procurement.write", "procurement.receive", "patients.write",
    "prescriptions.view", "prescriptions.verify", "prescriptions.edit",
    "staff.write", "reports.view",
    "users.manage", "branches.manage", "distribution.write",
    "clinic.tokens", "admin.console",
  ],
  // Deliberately NOT granted "admin.console" — a branch admin must not reach
  // the developer console.
  [UserRole.ADMIN]: [
    "billing.create", "billing.void", "billing.discount.large",
    "inventory.adjust", "inventory.write", "products.write", "products.delete",
    "procurement.write", "procurement.receive", "patients.write",
    "prescriptions.view", "prescriptions.verify", "prescriptions.edit",
    "staff.write", "reports.view",
    "users.manage", "branches.manage", "distribution.write",
    "clinic.tokens",
  ],
  [UserRole.PHARMACIST]: [
    "billing.create", "patients.write",
    "prescriptions.view", "prescriptions.verify", "prescriptions.edit",
    "inventory.adjust", "reports.view",
  ],
  [UserRole.CASHIER]: [
    "billing.create", "patients.write", "clinic.tokens",
  ],
  // Writes prescriptions from the consultation panel but does not verify them;
  // that stays with pharmacists, matching @Roles on POST /prescriptions/:id/verify.
  [UserRole.DOCTOR]: [
    "patients.write", "prescriptions.view", "clinic.doctor",
  ],
  [UserRole.INVENTORY_MANAGER]: [
    "inventory.adjust", "inventory.write", "products.write",
    "procurement.write", "procurement.receive", "reports.view",
  ],
  [UserRole.DISTRIBUTION_STAFF]: [
    "distribution.write",
  ],
  [UserRole.HR_MANAGER]: [
    "staff.write", "reports.view",
  ],
  [UserRole.REPORTS_ANALYST]: [
    "reports.view",
  ],
};

export function usePermissions() {
  const { user } = useAuthStore();
  const role = (user?.role ?? "") as UserRole;
  const allowed = ROLE_PERMISSIONS[role] ?? [];

  const can = (action: Action): boolean => allowed.includes(action);

  return { can, role };
}
