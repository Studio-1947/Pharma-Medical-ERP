import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import * as argon2 from "argon2";
import { UsersRepository } from "./users.repository";
import { AuthRepository } from "../auth/auth.repository";
import { AuditService } from "../../common/audit/audit.service";
import { AuditAction } from "../../common/audit/audit-actions";
import {
  UpdateUserDto,
  UserRole,
  type AdminCreateUserDto,
  type AdminUserQueryDto,
} from "@pharmerp/types";
import type { JwtPayload } from "../../common/decorators/current-user.decorator";
import { resolveBranchScope } from "../../common/auth/branch-scope";
import {
  assertCanAssignRole,
  assertCanManageUser,
  assertNotLastSuperAdmin,
  resolveAssignableBranch,
} from "../../common/auth/role-hierarchy";

/** Argon2 parameters used everywhere a password is hashed in this codebase. */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  timeCost: 2,
  memoryCost: 65536,
  parallelism: 1,
} as const;

/** Request context recorded alongside a privileged change. */
export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly repo: UsersRepository,
    private readonly authRepo: AuthRepository,
    private readonly audit: AuditService,
  ) {}

  async getAllUsers(query: AdminUserQueryDto, caller: JwtPayload) {
    // A branch admin sees only their own branch; super_admin sees everything,
    // or one branch when it explicitly asks. Previously unfiltered, which let
    // a branch admin enumerate every account — including the super_admin
    // addresses and the ids the mutation endpoints key on.
    const branchId = resolveBranchScope(caller, query.branchId);
    return this.repo.findAll({ ...query, branchId });
  }

  /** A caller may only read the accounts it could also write. */
  async getUserById(id: string, caller: JwtPayload) {
    return this.requireManageableUser(id, caller);
  }

  /**
   * The one API path that can create a super_admin.
   *
   * POST /auth/register stays closed to privileged roles; authority here is
   * decided by assertCanAssignRole against the caller.
   */
  async inviteUser(
    dto: AdminCreateUserDto,
    caller: JwtPayload,
    meta: RequestMeta = {},
  ) {
    const existing = await this.repo.findByEmail(dto.email);
    if (existing) throw new ConflictException("Email already registered");

    const role = assertCanAssignRole(caller, dto.role);
    const branchId = resolveAssignableBranch(caller, dto.branchId) ?? null;
    const passwordHash = await argon2.hash(dto.password, ARGON2_OPTIONS);

    const user = await this.repo.create({
      email: dto.email,
      firstName: dto.firstName,
      lastName: dto.lastName,
      role,
      branchId,
      passwordHash,
    });

    await this.audit.writeSafe({
      actorId: caller.sub,
      action: AuditAction.USER_CREATE,
      entity: "users",
      entityId: user?.id,
      newValue: { email: dto.email, role, branchId },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return user;
  }

  async updateUser(
    id: string,
    dto: UpdateUserDto,
    caller: JwtPayload,
    meta: RequestMeta = {},
  ) {
    const target = await this.requireManageableUser(id, caller);

    const patch: UpdateUserDto = { ...dto };
    let lockAction: "demote" | "deactivate" | null = null;

    if (dto.role !== undefined) {
      // Changing your own authority in one request means no second pair of
      // eyes and, on a demotion, immediate loss of the console — RolesGuard
      // reads the DB role, so it takes effect on the very next request.
      this.assertNotSelf(caller, id, "change your own role");
      patch.role = assertCanAssignRole(caller, dto.role) as UpdateUserDto["role"];
      if (patch.role !== target.role) lockAction = "demote";
    }

    if (dto.branchId !== undefined) {
      patch.branchId = resolveAssignableBranch(caller, dto.branchId) as
        | string
        | null;
    }

    if (dto.isActive === false) {
      this.assertNotSelf(caller, id, "deactivate your own account");
      lockAction = "deactivate";
    }

    const user = await this.guardedWrite(target, lockAction, (tx) =>
      this.repo.update(id, patch, tx),
    );
    if (!user) throw new NotFoundException("User not found");

    // A role change, a branch move or a deactivation all invalidate whatever
    // authority an open session was issued under.
    if (
      patch.role !== undefined ||
      patch.branchId !== undefined ||
      dto.isActive === false
    ) {
      await this.authRepo.revokeAllUserTokens(id);
    }

    await this.audit.writeSafe({
      actorId: caller.act?.sub ?? caller.sub,
      action: AuditAction.USER_UPDATE,
      entity: "users",
      entityId: id,
      oldValue: {
        role: target.role,
        branchId: target.branchId,
        isActive: target.isActive,
      },
      newValue: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return user;
  }

  async changeRole(
    id: string,
    role: string,
    caller: JwtPayload,
    meta: RequestMeta = {},
  ) {
    const target = await this.requireManageableUser(id, caller);
    this.assertNotSelf(caller, id, "change your own role");
    const nextRole = assertCanAssignRole(caller, role);

    const user = await this.guardedWrite(
      target,
      nextRole !== target.role ? "demote" : null,
      (tx) => this.repo.changeRole(id, nextRole, tx),
    );
    if (!user) throw new NotFoundException("User not found");

    // Force re-authentication so the new role can't be worked around by
    // holding on to a session opened under the old one.
    await this.authRepo.revokeAllUserTokens(id);

    await this.audit.writeSafe({
      actorId: caller.act?.sub ?? caller.sub,
      action: AuditAction.USER_ROLE_CHANGE,
      entity: "users",
      entityId: id,
      oldValue: { role: target.role },
      newValue: { role: nextRole },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return user;
  }

  async deactivateUser(id: string, caller: JwtPayload, meta: RequestMeta = {}) {
    const target = await this.requireManageableUser(id, caller);
    this.assertNotSelf(caller, id, "deactivate your own account");

    const user = await this.guardedWrite(target, "deactivate", (tx) =>
      this.repo.setActive(id, false, tx),
    );
    if (!user) throw new NotFoundException("User not found");

    // Close the session outright rather than leaving refresh tokens that only
    // fail once someone tries to use them.
    await this.authRepo.revokeAllUserTokens(id);

    await this.audit.writeSafe({
      actorId: caller.act?.sub ?? caller.sub,
      action: AuditAction.USER_DEACTIVATE,
      entity: "users",
      entityId: id,
      oldValue: { isActive: true },
      newValue: { isActive: false },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return user;
  }

  async reactivateUser(id: string, caller: JwtPayload, meta: RequestMeta = {}) {
    await this.requireManageableUser(id, caller);
    const user = await this.repo.setActive(id, true);
    if (!user) throw new NotFoundException("User not found");

    await this.audit.writeSafe({
      actorId: caller.act?.sub ?? caller.sub,
      action: AuditAction.USER_REACTIVATE,
      entity: "users",
      entityId: id,
      oldValue: { isActive: false },
      newValue: { isActive: true },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return user;
  }

  async getNotificationPrefs(userId: string) {
    const prefs = await this.repo.getNotificationPrefs(userId);
    return { data: prefs };
  }

  async updateNotificationPrefs(
    userId: string,
    prefs: Record<string, { email: boolean; sms: boolean }>,
  ) {
    await this.repo.updateNotificationPrefs(userId, prefs);
    return { success: true };
  }

  async deactivateDemoAccounts(caller: JwtPayload, meta: RequestMeta = {}) {
    if (caller.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException("Only super_admin can bulk deactivate demo accounts");
    }
    const demoEmails = [
      "admin@mederp.com",
      "pharmacist@mederp.com",
      "cashier@mederp.com",
      "doctor@mederp.com",
      "analyst@mederp.com",
    ];
    let deactivatedCount = 0;
    for (const email of demoEmails) {
      const user = await this.repo.findByEmail(email);
      if (user && user.isActive && user.id !== caller.sub) {
        await this.deactivateUser(user.id, caller, meta);
        deactivatedCount++;
      }
    }
    return { message: `Deactivated ${deactivatedCount} demo account(s)`, deactivatedCount };
  }

  // -----------------------------------------------------------------------

  /** Loads the target and rejects callers who do not outrank it. */
  private async requireManageableUser(id: string, caller: JwtPayload) {
    const target = await this.repo.findById(id);
    if (!target) throw new NotFoundException("User not found");
    assertCanManageUser(caller, target);
    return target;
  }

  private assertNotSelf(caller: JwtPayload, targetId: string, what: string) {
    if (caller.sub === targetId) {
      throw new ForbiddenException(`You cannot ${what}`);
    }
  }

  /**
   * Performs a write, holding the super_admin row lock when the change could
   * remove the last one.
   *
   * Only super_admin targets can trip the lockout guard; taking the lock for
   * every user write would serialise all of them behind one row set for no
   * benefit.
   */
  private async guardedWrite<T>(
    target: { id: string; role: string; isActive?: boolean },
    action: "demote" | "deactivate" | null,
    write: (tx?: any) => Promise<T>,
  ): Promise<T> {
    if (!action || target.role !== UserRole.SUPER_ADMIN) {
      return write(undefined);
    }
    return this.repo.withSuperAdminLock(async (count, tx) => {
      assertNotLastSuperAdmin(target, count, action);
      return write(tx);
    });
  }
}
