import { describe, it, expect } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import { resolveBranchScope, requireBranchScope } from "../branch-scope";
import type { JwtPayload } from "../../decorators/current-user.decorator";

const BRANCH_A = "11111111-1111-1111-1111-111111111111";
const BRANCH_B = "22222222-2222-2222-2222-222222222222";

function user(role: string, branchId?: string): JwtPayload {
  return {
    sub: "user-1",
    email: "u@example.com",
    role,
    branchId,
    iat: 0,
    exp: 0,
  };
}

describe("resolveBranchScope", () => {
  it("lets super_admin read across all branches when none is requested", () => {
    expect(resolveBranchScope(user("super_admin"))).toBeUndefined();
  });

  it("lets super_admin target any branch explicitly", () => {
    expect(resolveBranchScope(user("super_admin"), BRANCH_B)).toBe(BRANCH_B);
  });

  it("pins a branch role to its own branch when none is requested", () => {
    expect(resolveBranchScope(user("pharmacist", BRANCH_A))).toBe(BRANCH_A);
  });

  it("allows a branch role to request its own branch", () => {
    expect(resolveBranchScope(user("pharmacist", BRANCH_A), BRANCH_A)).toBe(
      BRANCH_A,
    );
  });

  // The bug this module exists to prevent: branchId is a client-supplied query
  // param, so a branch user must not be able to read another branch's data.
  it("rejects a branch role reaching into another branch", () => {
    expect(() =>
      resolveBranchScope(user("pharmacist", BRANCH_A), BRANCH_B),
    ).toThrow(ForbiddenException);
  });

  it("treats admin as branch-scoped, not global", () => {
    expect(() => resolveBranchScope(user("admin", BRANCH_A), BRANCH_B)).toThrow(
      ForbiddenException,
    );
    expect(resolveBranchScope(user("admin", BRANCH_A))).toBe(BRANCH_A);
  });

  it("rejects a non-super_admin with no branch assigned", () => {
    expect(() => resolveBranchScope(user("reports_analyst"))).toThrow(
      ForbiddenException,
    );
  });
});

describe("requireBranchScope", () => {
  it("returns the caller's branch for a branch role", () => {
    expect(requireBranchScope(user("pharmacist", BRANCH_A))).toBe(BRANCH_A);
  });

  it("rejects super_admin's all-branches case where a branch is mandatory", () => {
    expect(() => requireBranchScope(user("super_admin"))).toThrow(
      ForbiddenException,
    );
  });

  it("still blocks cross-branch access", () => {
    expect(() =>
      requireBranchScope(user("inventory_manager", BRANCH_A), BRANCH_B),
    ).toThrow(ForbiddenException);
  });
});
