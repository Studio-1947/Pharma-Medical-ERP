import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { randomUUID } from "crypto";
import { UsersRepository } from "../users/users.repository";
import { AuditService } from "../../common/audit/audit.service";
import { AuditAction } from "../../common/audit/audit-actions";
import { UserRole, type ImpersonateDto } from "@pharmerp/types";
import type { JwtPayload } from "../../common/decorators/current-user.decorator";
import type { RequestMeta } from "../users/users.service";

/** Hard ceiling on an impersonation session, regardless of what is requested. */
export const IMPERSONATION_MAX_MINUTES = 60;

@Injectable()
export class ImpersonationService {
  private readonly logger = new Logger(ImpersonationService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly usersRepo: UsersRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * Mints a short-lived token that acts as another user.
   *
   * Returns an access token and nothing else. That omission is the load-bearing
   * part of the design, not an oversight — see the comment above the sign call.
   */
  async start(
    targetId: string,
    actor: JwtPayload,
    dto: ImpersonateDto,
    meta: RequestMeta = {},
  ) {
    // Checked explicitly rather than relying only on @Roles: RolesGuard passes
    // super_admin by bypass, so a reader cannot tell an allowlist from a
    // short-circuit, and this must survive the decorator being dropped.
    if (actor.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException("Only a super_admin may impersonate");
    }
    // No chaining — an impersonated session must not open another.
    if (actor.act) {
      throw new ForbiddenException("Already impersonating another user");
    }

    const target = await this.usersRepo.findById(targetId);
    if (!target) throw new NotFoundException("User not found");
    if (target.id === actor.sub) {
      throw new BadRequestException("You are already signed in as yourself");
    }
    if (!target.isActive) {
      throw new ForbiddenException("Cannot impersonate an inactive account");
    }
    // A super_admin target would be an unbounded session: RolesGuard passes
    // super_admin everywhere, so the token would carry full authority under
    // someone else's name.
    if (target.role === UserRole.SUPER_ADMIN) {
      throw new ForbiddenException("Cannot impersonate another super_admin");
    }

    const sid = randomUUID();
    const ttlSeconds =
      Math.min(dto.durationMinutes ?? 15, IMPERSONATION_MAX_MINUTES) * 60;

    // Awaited, and before the token exists: an impersonation that could not be
    // recorded must not be granted. This is the one audit write in the system
    // that is part of the guarantee rather than a side effect.
    await this.audit.write({
      actorId: actor.sub,
      action: AuditAction.IMPERSONATION_START,
      entity: "users",
      entityId: target.id,
      newValue: {
        sid,
        targetEmail: target.email,
        targetRole: target.role,
        targetBranchId: target.branchId,
        ttlSeconds,
        reason: dto.reason,
      },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    // NO REFRESH TOKEN, deliberately. AuthService.issueTokens rebuilds its
    // payload from the user row and never spreads an incoming one, so `act`
    // cannot survive a refresh. Had this returned a refresh token, presenting
    // it to the public POST /auth/refresh would yield a clean target-role
    // token with no `act` claim and a full-length expiry — the TTL cap
    // defeated and the audit trail severed. The frontend does exactly that
    // automatically on any 401, so it would have happened by accident.
    //
    // sign() merges options, so expiresIn overrides while RS256 and the
    // private key from AuthModule are retained. Seconds, not "15m": a string
    // typo would throw at request time instead of being obviously wrong here.
    const accessToken = this.jwt.sign(
      {
        sub: target.id,
        email: target.email,
        role: target.role,
        branchId: target.branchId ?? undefined,
        act: { sub: actor.sub, email: actor.email, sid },
      },
      { expiresIn: ttlSeconds },
    );

    this.logger.warn(
      `IMPERSONATION START: ${actor.email} -> ${target.email} (${target.role}) for ${ttlSeconds}s [sid=${sid}]`,
    );

    return {
      accessToken,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      sid,
      target: {
        id: target.id,
        email: target.email,
        firstName: target.firstName,
        lastName: target.lastName,
        role: target.role,
        branchId: target.branchId,
      },
      actor: { id: actor.sub, email: actor.email },
    };
  }

  /**
   * Records the end of an impersonation.
   *
   * There is no server-side session to tear down — the token is stateless and
   * simply expires — so this exists to close the audit trail. The client
   * restores the operator's own session regardless of what happens here.
   */
  async stop(caller: JwtPayload, meta: RequestMeta = {}) {
    if (!caller.act) {
      throw new BadRequestException("Not currently impersonating");
    }

    // actorId is the real operator on BOTH rows: audit_logs.userId is the only
    // queryable actor column, and the log has to be able to answer "what did
    // this super_admin do".
    await this.audit.writeSafe({
      actorId: caller.act.sub,
      action: AuditAction.IMPERSONATION_STOP,
      entity: "users",
      entityId: caller.sub,
      newValue: { sid: caller.act.sid, targetEmail: caller.email },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    this.logger.warn(
      `IMPERSONATION STOP: ${caller.act.email} -> ${caller.email} [sid=${caller.act.sid}]`,
    );

    return { message: "Impersonation ended" };
  }
}
