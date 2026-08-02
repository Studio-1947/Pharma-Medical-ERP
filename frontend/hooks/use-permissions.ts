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
  | "staff.write"
  | "reports.view"
  | "users.manage"
  | "branches.manage"
  | "distribution.write"
  | "clinic.tokens"
  | "clinic.doctor";

const ROLE_PERMISSIONS: Record<UserRole, Action[]> = {
  [UserRole.SUPER_ADMIN]: [
    "billing.create", "billing.void", "billing.discount.large",
    "inventory.adjust", "inventory.write", "products.write", "products.delete",
    "procurement.write", "procurement.receive", "patients.write",
    "prescriptions.view", "prescriptions.verify", "staff.write", "reports.view",
    "users.manage", "branches.manage", "distribution.write",
    "clinic.tokens",
  ],
  [UserRole.ADMIN]: [
    "billing.create", "billing.void", "billing.discount.large",
    "inventory.adjust", "inventory.write", "products.write", "products.delete",
    "procurement.write", "procurement.receive", "patients.write",
    "prescriptions.view", "prescriptions.verify", "staff.write", "reports.view",
    "users.manage", "branches.manage", "distribution.write",
    "clinic.tokens",
  ],
  [UserRole.PHARMACIST]: [
    "billing.create", "patients.write",
    "prescriptions.view", "prescriptions.verify",
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
