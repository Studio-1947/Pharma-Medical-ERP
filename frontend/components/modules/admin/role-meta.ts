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
  UserRole.SHOP_MANAGER,
  UserRole.DOCTOR,
];

export const ROLE_COLOR: Record<string, string> = {
  [UserRole.SUPER_ADMIN]: "bg-purple-100 text-purple-700",
  [UserRole.ADMIN]: "bg-emerald-100 text-emerald-700",
  [UserRole.SHOP_MANAGER]: "bg-amber-100 text-amber-700",
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
