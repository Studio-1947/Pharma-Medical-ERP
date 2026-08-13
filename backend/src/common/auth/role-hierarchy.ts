import { ForbiddenException } from "@nestjs/common";
import { UserRole } from "@pharmerp/types";
import type { JwtPayload } from "../decorators/current-user.decorator";

/**
 * Who is allowed to hand out which role, and who is allowed to touch whom.
 *
 * The register() path in auth.service already refused to mint privileged
 * accounts, but two later-added endpoints reached the same column without
 * going through it — PATCH /users/:id/role (validated the role was a real enum
 * member but never that the caller outranked it) and PATCH /users/:id (whose
 * updateUserSchema typed role as a bare string and wrote it through with an
 * `as any`). Either one let a branch admin promote themselves to super_admin,
 * so the check lives here now and every write path calls into it.
 */

/** Roles a branch admin may onboard and manage. Mirrors auth.service.register(). */
export const BRANCH_LEVEL_ROLES: readonly string[] = [
  UserRole.SHOP_MANAGER,
  UserRole.DOCTOR,
];

/** Roles that can administer other accounts. Only super_admin may grant these. */
export const PRIVILEGED_ROLES: readonly string[] = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
];

export function isValidRole(role: string): boolean {
  return (Object.values(UserRole) as string[]).includes(role);
}

/**
 * Normalises a client-supplied role string to the lowercase enum value.
 *
 * The invite form posts uppercase keys ("CASHIER") because registerSchema
 * lowercases them; anything else reaching the DB unnormalised would be written
 * as an invalid enum literal and fail at the driver rather than at validation.
 */
export function normaliseRole(role: string): string {
  return role.trim().toLowerCase();
}

/**
 * Rejects a role assignment the caller does not outrank.
 *
 * super_admin may grant anything, including another super_admin — that is the
 * deliberate capability behind the admin console. admin is capped at
 * branch-level staff (shop_manager, doctor).
 */
export function assertCanAssignRole(caller: JwtPayload, requestedRole: string): string {
  const role = normaliseRole(requestedRole);

  if (!isValidRole(role)) {
    throw new ForbiddenException(`Invalid role: ${requestedRole}`);
  }

  if (caller.role === UserRole.SUPER_ADMIN) return role;

  if (caller.role === UserRole.ADMIN) {
    if (!BRANCH_LEVEL_ROLES.includes(role)) {
      throw new ForbiddenException(
        "Admins can only assign branch-level staff roles",
      );
    }
    return role;
  }

  throw new ForbiddenException("You are not allowed to assign roles");
}

/**
 * Rejects an attempt to administer an account the caller does not outrank.
 *
 * Without this an admin could deactivate or rewrite a super_admin, or reach
 * into another branch's staff by guessing a user id — the id is the only thing
 * the route needed and it is not secret.
 */
export function assertCanManageUser(
  caller: JwtPayload,
  target: { id: string; role: string; branchId?: string | null },
): void {
  if (caller.role === UserRole.SUPER_ADMIN) return;

  if (caller.role !== UserRole.ADMIN) {
    throw new ForbiddenException("You are not allowed to manage user accounts");
  }

  if (PRIVILEGED_ROLES.includes(target.role)) {
    throw new ForbiddenException(
      "Admins cannot manage admin or super_admin accounts",
    );
  }

  if (!caller.branchId) {
    throw new ForbiddenException("Admin account is not assigned to a branch");
  }

  if (target.branchId !== caller.branchId) {
    throw new ForbiddenException(
      "You can only manage users within your own branch",
    );
  }
}

/**
 * Rejects a branch reassignment the caller is not entitled to make.
 * A branch admin may only place users inside their own branch.
 */
export function resolveAssignableBranch(
  caller: JwtPayload,
  requestedBranchId: string | null | undefined,
): string | null | undefined {
  if (caller.role === UserRole.SUPER_ADMIN) return requestedBranchId;

  if (requestedBranchId === undefined) return undefined;

  if (!caller.branchId) {
    throw new ForbiddenException("Admin account is not assigned to a branch");
  }

  if (requestedBranchId !== caller.branchId) {
    throw new ForbiddenException(
      "You can only assign users to your own branch",
    );
  }

  return requestedBranchId;
}

/**
 * Blocks the change that would leave the system with no way back in.
 *
 * Demoting or deactivating the last active super_admin locks everyone out of
 * user administration permanently, and the only remedy is direct DB access.
 */
export function assertNotLastSuperAdmin(
  target: { id: string; role: string; isActive?: boolean },
  activeSuperAdminCount: number,
  action: "demote" | "deactivate",
): void {
  if (target.role !== UserRole.SUPER_ADMIN) return;
  // An already-inactive super_admin is not part of activeSuperAdminCount, so
  // neither demoting nor deactivating it can reduce that count. Guarding it
  // would refuse harmless housekeeping — "demote the disabled super_admin
  // nobody uses" — with a message claiming it is the last active one.
  if (target.isActive === false) return;
  if (activeSuperAdminCount > 1) return;

  throw new ForbiddenException(
    `Cannot ${action} the last active super_admin — promote another super_admin first`,
  );
}
