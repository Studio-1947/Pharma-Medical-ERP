import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import * as argon2 from "argon2";
import { AdminRepository } from "./admin.repository";
import { UsersRepository } from "../users/users.repository";
import { AuthRepository } from "../auth/auth.repository";
import { AuditService } from "../../common/audit/audit.service";
import { AuditAction, AUDIT_ACTIONS } from "../../common/audit/audit-actions";
import { ARGON2_OPTIONS, type RequestMeta } from "../users/users.service";
import { assertCanManageUser } from "../../common/auth/role-hierarchy";
import type {
  AdminSetPasswordDto,
  AuditLogQueryDto,
  SessionQueryDto,
} from "@pharmerp/types";
import type { JwtPayload } from "../../common/decorators/current-user.decorator";

@Injectable()
export class AdminService {
  constructor(
    private readonly repo: AdminRepository,
    private readonly usersRepo: UsersRepository,
    private readonly authRepo: AuthRepository,
    private readonly audit: AuditService,
  ) {}

  getOverview() {
    return this.repo.getOverview();
  }

  listAuditLogs(query: AuditLogQueryDto) {
    return this.repo.listAuditLogs(query);
  }

  /**
   * Known action names plus any already in the table, so the filter dropdown
   * still offers historical values after the vocabulary changes.
   */
  async listAuditActions() {
    const seen = await this.repo.listAuditActions();
    const merged = Array.from(new Set([...AUDIT_ACTIONS, ...seen])).sort();
    return { data: merged };
  }

  listSessions(query: SessionQueryDto) {
    return this.repo.listSessions(query);
  }

  async revokeSession(
    sessionId: string,
    caller: JwtPayload,
    meta: RequestMeta = {},
  ) {
    const session = await this.repo.findSessionById(sessionId);
    if (!session) throw new NotFoundException("Session not found");

    // Idempotent: revoking an already-revoked session is a no-op, not an
    // error. The list can easily be a few seconds stale.
    if (session.revokedAt) {
      return { message: "Session already revoked" };
    }

    const owner = await this.usersRepo.findById(session.userId);
    if (!owner) throw new NotFoundException("Session owner not found");
    // Without this a branch admin could sign a super_admin out repeatedly —
    // a denial of service aimed at the recovery path.
    assertCanManageUser(caller, owner);

    await this.authRepo.revokeRefreshToken(sessionId);

    await this.audit.writeSafe({
      actorId: caller.sub,
      action: AuditAction.SESSION_REVOKE,
      entity: "refresh_tokens",
      entityId: sessionId,
      newValue: { userId: session.userId, email: owner.email },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return { message: "Session revoked" };
  }

  async revokeAllSessions(
    userId: string,
    caller: JwtPayload,
    meta: RequestMeta = {},
  ) {
    const owner = await this.usersRepo.findById(userId);
    if (!owner) throw new NotFoundException("User not found");
    assertCanManageUser(caller, owner);

    await this.authRepo.revokeAllUserTokens(userId);

    await this.audit.writeSafe({
      actorId: caller.sub,
      action: AuditAction.SESSIONS_REVOKE_ALL,
      entity: "users",
      entityId: userId,
      newValue: { email: owner.email },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return { message: `All sessions revoked for ${owner.email}` };
  }

  /**
   * Sets a user's password without knowing the old one.
   *
   * This is AuthService.changePassword minus the argon2.verify step, so the
   * argon2 parameters are imported rather than re-inlined — two copies would
   * quietly become two password-strength tiers.
   */
  async setPassword(
    targetId: string,
    dto: AdminSetPasswordDto,
    caller: JwtPayload,
    meta: RequestMeta = {},
  ) {
    const target = await this.usersRepo.findById(targetId);
    if (!target) throw new NotFoundException("User not found");
    assertCanManageUser(caller, target);

    // Your own password goes through /auth/change-password, which verifies the
    // current one. Allowing it here would let a hijacked admin session lock out
    // the real owner without ever proving it knew the password.
    if (caller.sub === targetId) {
      throw new ForbiddenException(
        "Use /auth/change-password to change your own password",
      );
    }

    const hash = await argon2.hash(dto.newPassword, ARGON2_OPTIONS);

    // Both calls are required and neither is sufficient on its own:
    //  - updatePasswordHash sets passwordChangedAt, which JwtStrategy uses to
    //    reject every ACCESS token issued before it.
    //  - without revokeAllUserTokens the refresh token still validates
    //    (findValidRefreshToken checks only hash/revokedAt/expiresAt) and
    //    mints a fresh access token whose newer iat clears that comparison.
    await this.authRepo.updatePasswordHash(targetId, hash);
    if (dto.revokeSessions !== false) {
      await this.authRepo.revokeAllUserTokens(targetId);
    }

    await this.audit.writeSafe({
      actorId: caller.sub,
      action: AuditAction.ADMIN_PASSWORD_RESET,
      entity: "users",
      entityId: targetId,
      // The password itself is never recorded; AuditService also redacts it.
      newValue: {
        email: target.email,
        revokedSessions: dto.revokeSessions !== false,
      },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return { message: "Password reset. The user must sign in again." };
  }
}
