import { UserRole } from "@pharmerp/types";

/**
 * Role presentation, keyed on the lowercase enum values the API actually
 * returns. An earlier UPPERCASE-keyed map in settings/users-settings.tsx never
 * matched anything, so every badge silently fell through to the grey default.
 */

/** Every assignable role, super_admin first — the console can grant them all. */
export const ROLE_OPTIONS: string[] = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.PHARMACIST,
  UserRole.CASHIER,
  UserRole.INVENTORY_MANAGER,
  UserRole.DISTRIBUTION_STAFF,
  UserRole.HR_MANAGER,
  UserRole.REPORTS_ANALYST,
  UserRole.DOCTOR,
];

export const ROLE_COLOR: Record<string, string> = {
  [UserRole.SUPER_ADMIN]: "bg-purple-100 text-purple-700",
  [UserRole.ADMIN]: "bg-emerald-100 text-emerald-700",
  [UserRole.PHARMACIST]: "bg-green-100 text-green-700",
  [UserRole.CASHIER]: "bg-amber-100 text-amber-700",
  [UserRole.INVENTORY_MANAGER]: "bg-teal-100 text-teal-700",
  [UserRole.DISTRIBUTION_STAFF]: "bg-orange-100 text-orange-700",
  [UserRole.HR_MANAGER]: "bg-pink-100 text-pink-700",
  [UserRole.REPORTS_ANALYST]: "bg-slate-100 text-slate-700",
  [UserRole.DOCTOR]: "bg-sky-100 text-sky-700",
};

export function roleColor(role: string): string {
  return ROLE_COLOR[role] ?? "bg-slate-100 text-slate-600";
}

export function roleLabel(role: string): string {
  return role
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
