import { Injectable, Logger } from "@nestjs/common";
import { DrizzleService } from "../../database/drizzle.service";
import { auditLogs } from "../../database/schema";
import type { AuditAction } from "./audit-actions";

export interface AuditWrite {
  /**
   * The account that actually performed the action. During impersonation this
   * must be the real super_admin (`req.user.act.sub`), never the impersonated
   * `sub` — otherwise the trail attributes the action to the wrong person,
   * which is the one question an audit log exists to answer.
   */
  actorId?: string | null;
  action: AuditAction | string;
  entity: string;
  /** Must be a uuid or omitted — audit_logs.entity_id is a uuid column. */
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * The only writer to audit_logs.
 *
 * An AuditInterceptor factory already existed in common/interceptors, but it
 * was never applied to a single route, so audit_logs has always been empty.
 * It is not revived here: an interceptor bakes its action/entity in at
 * decoration time, so it cannot express IMPERSONATION_START, and it cannot see
 * the before-image. The service layer is the only place both states exist, and
 * it matches how users.service already calls cross-cutting side effects
 * (authRepo.revokeAllUserTokens) inline.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
  }

  /**
   * Writes one audit row and lets failures propagate.
   *
   * Use where the row is part of the guarantee: an impersonation that was not
   * recorded must not be granted.
   */
  async write(entry: AuditWrite): Promise<void> {
    await this.db.insert(auditLogs).values({
      userId: entry.actorId ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      oldValue: entry.oldValue !== undefined ? serialise(entry.oldValue) : null,
      newValue: entry.newValue !== undefined ? serialise(entry.newValue) : null,
      ipAddress: (entry.ipAddress ?? null) as any,
      userAgent: entry.userAgent ?? null,
    });
  }

  /**
   * Best-effort variant. Use where losing the row is preferable to failing the
   * user-facing action — a failed audit write must not turn a completed
   * password reset into a 500 the operator retries against an already-changed
   * password. Failures are logged so a silently broken trail stays visible.
   */
  async writeSafe(entry: AuditWrite): Promise<void> {
    try {
      await this.write(entry);
    } catch (err) {
      this.logger.error(
        `Failed to write audit log ${entry.action} on ${entry.entity}: ${String(err)}`,
      );
    }
  }
}

/** Never let a secret ride along into a table built for reading. */
const REDACTED_KEYS = new Set([
  "password",
  "newPassword",
  "currentPassword",
  "passwordHash",
  "temporaryPassword",
  "twoFaSecret",
  "accessToken",
  "refreshToken",
  "tokenHash",
]);

function serialise(value: unknown): string {
  return JSON.stringify(value, (key, val) =>
    REDACTED_KEYS.has(key) ? "[REDACTED]" : val,
  );
}
