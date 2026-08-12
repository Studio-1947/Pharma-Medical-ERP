import { ForbiddenException } from "@nestjs/common";
import type { JwtPayload } from "../decorators/current-user.decorator";

/**
 * Resolves which branch a request is allowed to touch.
 *
 * `branchId` arrives as a client-supplied query param, so it can never be
 * trusted on its own — without this check any branch user could read another
 * branch's sales, GST filings or cash position by editing the param.
 *
 * Only super_admin is unscoped (it is the sole role with a null branchId).
 * Every other role — including `admin`, which is a *branch* admin — is pinned
 * to its own branch, matching the rule already enforced in auth.service
 * register(). A returned `undefined` means "all branches" and is reachable
 * only by super_admin.
 */
export function resolveBranchScope(
  user: JwtPayload,
  requestedBranchId?: string,
): string | undefined {
  if (user.role === "super_admin") {
    return requestedBranchId;
  }

  if (!user.branchId) {
    throw new ForbiddenException("Account is not assigned to a branch");
  }

  if (requestedBranchId && requestedBranchId !== user.branchId) {
    throw new ForbiddenException(
      "You can only access data for your own branch",
    );
  }

  return user.branchId;
}

/**
 * Same as resolveBranchScope but for endpoints that cannot operate without a
 * concrete branch — either because the answer is meaningless across branches
 * (GST return, ABC analysis) or because the row being written has to land in
 * one (a warehouse, a clinic token). Rejects the super_admin "all branches"
 * case rather than picking a branch on its behalf.
 */
export function requireBranchScope(
  user: JwtPayload,
  requestedBranchId?: string,
): string {
  const branchId = resolveBranchScope(user, requestedBranchId);
  if (!branchId) {
    throw new ForbiddenException(
      "branchId is required - super_admin must select a branch for this action",
    );
  }
  return branchId;
}

/** Enforces branch ownership after loading an existing record by ID. */
export function assertBranchAccess(user: JwtPayload, recordBranchId: string | null | undefined): void {
  if (!recordBranchId && user.role !== "super_admin") {
    throw new ForbiddenException("You can only access branch-scoped data");
  }
  const allowedBranchId = resolveBranchScope(user);
  if (allowedBranchId && allowedBranchId !== recordBranchId) {
    throw new ForbiddenException("You can only access data for your own branch");
  }
}
