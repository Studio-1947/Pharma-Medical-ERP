import { describe, it, expect } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import {
  assertCanAssignRole,
  assertCanManageUser,
  assertNotLastSuperAdmin,
  normaliseRole,
  resolveAssignableBranch,
  isValidRole,
} from "../role-hierarchy";
import type { JwtPayload } from "../../decorators/current-user.decorator";

const BRANCH_A = "11111111-1111-1111-1111-111111111111";
const BRANCH_B = "22222222-2222-2222-2222-222222222222";

function caller(role: string, branchId?: string, sub = "caller-1"): JwtPayload {
  return { sub, email: "u@example.com", role, branchId, iat: 0, exp: 0 };
}

function target(role: string, branchId?: string | null, id = "target-1") {
  return { id, role, branchId };
}

describe("normaliseRole / isValidRole", () => {
  it("lowercases and trims the uppercase role keys the invite form posts", () => {
    expect(normaliseRole("  SHOP_MANAGER ")).toBe("shop_manager");
  });

  it("accepts real enum members and rejects junk", () => {
    expect(isValidRole("shop_manager")).toBe(true);
    expect(isValidRole("wizard")).toBe(false);
  });
});

describe("assertCanAssignRole", () => {
  it("lets super_admin mint another super_admin", () => {
    expect(assertCanAssignRole(caller("super_admin"), "super_admin")).toBe(
      "super_admin",
    );
  });

  it("lets super_admin grant any branch-level role", () => {
    expect(assertCanAssignRole(caller("super_admin"), "doctor")).toBe("doctor");
  });

  it("normalises the role it returns so an invalid enum literal never reaches the DB", () => {
    expect(assertCanAssignRole(caller("super_admin"), "SHOP_MANAGER")).toBe("shop_manager");
  });

  // The escalation this module exists to prevent: PATCH /users/:id/role was
  // open to admin and only checked that the value was a real enum member.
  it("blocks a branch admin promoting anyone to super_admin", () => {
    expect(() =>
      assertCanAssignRole(caller("admin", BRANCH_A), "super_admin"),
    ).toThrow(ForbiddenException);
  });

  it("blocks a branch admin minting another admin", () => {
    expect(() => assertCanAssignRole(caller("admin", BRANCH_A), "admin")).toThrow(
      ForbiddenException,
    );
  });

  it("lets a branch admin grant branch-level roles", () => {
    expect(assertCanAssignRole(caller("admin", BRANCH_A), "shop_manager")).toBe(
      "shop_manager",
    );
  });

  it("rejects an unknown role outright", () => {
    expect(() => assertCanAssignRole(caller("super_admin"), "wizard")).toThrow(
      ForbiddenException,
    );
  });

  it("rejects a non-administrative caller entirely", () => {
    expect(() =>
      assertCanAssignRole(caller("shop_manager", BRANCH_A), "doctor"),
    ).toThrow(ForbiddenException);
  });
});

describe("assertCanManageUser", () => {
  it("lets super_admin manage anyone, including another super_admin", () => {
    expect(() =>
      assertCanManageUser(caller("super_admin"), target("super_admin", null)),
    ).not.toThrow();
  });

  it("lets a branch admin manage staff in their own branch", () => {
    expect(() =>
      assertCanManageUser(caller("admin", BRANCH_A), target("shop_manager", BRANCH_A)),
    ).not.toThrow();
  });

  it("blocks a branch admin from touching a super_admin", () => {
    expect(() =>
      assertCanManageUser(caller("admin", BRANCH_A), target("super_admin", null)),
    ).toThrow(ForbiddenException);
  });

  it("blocks a branch admin from touching a peer admin", () => {
    expect(() =>
      assertCanManageUser(caller("admin", BRANCH_A), target("admin", BRANCH_A)),
    ).toThrow(ForbiddenException);
  });

  // A user id is not a secret, so cross-branch reach has to be closed here
  // rather than relying on the caller not knowing the id.
  it("blocks a branch admin reaching into another branch's staff", () => {
    expect(() =>
      assertCanManageUser(caller("admin", BRANCH_A), target("shop_manager", BRANCH_B)),
    ).toThrow(ForbiddenException);
  });

  it("blocks an admin with no branch assignment", () => {
    expect(() =>
      assertCanManageUser(caller("admin"), target("shop_manager", BRANCH_A)),
    ).toThrow(ForbiddenException);
  });

  it("blocks a non-administrative role", () => {
    expect(() =>
      assertCanManageUser(caller("shop_manager", BRANCH_A), target("shop_manager", BRANCH_A)),
    ).toThrow(ForbiddenException);
  });
});

describe("resolveAssignableBranch", () => {
  it("lets super_admin place a user in any branch", () => {
    expect(resolveAssignableBranch(caller("super_admin"), BRANCH_B)).toBe(BRANCH_B);
  });

  it("lets super_admin clear the branch (the unscoped super_admin case)", () => {
    expect(resolveAssignableBranch(caller("super_admin"), null)).toBeNull();
  });

  it("passes through an omitted branch untouched so a partial update stays partial", () => {
    expect(
      resolveAssignableBranch(caller("admin", BRANCH_A), undefined),
    ).toBeUndefined();
  });

  it("lets a branch admin assign to their own branch", () => {
    expect(resolveAssignableBranch(caller("admin", BRANCH_A), BRANCH_A)).toBe(
      BRANCH_A,
    );
  });

  it("blocks a branch admin moving a user into another branch", () => {
    expect(() =>
      resolveAssignableBranch(caller("admin", BRANCH_A), BRANCH_B),
    ).toThrow(ForbiddenException);
  });
});

describe("assertNotLastSuperAdmin", () => {
  it("ignores non-super_admin targets", () => {
    expect(() =>
      assertNotLastSuperAdmin(target("shop_manager"), 1, "demote"),
    ).not.toThrow();
  });

  it("allows demoting a super_admin while another active one remains", () => {
    expect(() =>
      assertNotLastSuperAdmin(target("super_admin"), 2, "demote"),
    ).not.toThrow();
  });

  // Losing the last super_admin locks everyone out of user administration with
  // no in-app remedy, so this is refused rather than warned about.
  it("blocks demoting the last active super_admin", () => {
    expect(() =>
      assertNotLastSuperAdmin(target("super_admin"), 1, "demote"),
    ).toThrow(ForbiddenException);
  });

  it("blocks deactivating the last active super_admin", () => {
    expect(() =>
      assertNotLastSuperAdmin(
        { id: "t", role: "super_admin", isActive: true },
        1,
        "deactivate",
      ),
    ).toThrow(ForbiddenException);
  });

  it("is a no-op when deactivating an already-inactive super_admin", () => {
    expect(() =>
      assertNotLastSuperAdmin(
        { id: "t", role: "super_admin", isActive: false },
        1,
        "deactivate",
      ),
    ).not.toThrow();
  });

  // An inactive super_admin is not counted in activeSuperAdminCount, so
  // demoting it cannot strand anyone. Refusing it blocked legitimate cleanup
  // with a message that was also untrue.
  it("allows demoting an already-inactive super_admin even when one active remains", () => {
    expect(() =>
      assertNotLastSuperAdmin(
        { id: "t", role: "super_admin", isActive: false },
        1,
        "demote",
      ),
    ).not.toThrow();
  });

  it("still blocks demoting the sole ACTIVE super_admin", () => {
    expect(() =>
      assertNotLastSuperAdmin(
        { id: "t", role: "super_admin", isActive: true },
        1,
        "demote",
      ),
    ).toThrow(ForbiddenException);
  });
});
