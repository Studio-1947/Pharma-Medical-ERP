import { Injectable } from "@nestjs/common";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { DrizzleService } from "../../database/drizzle.service";
import * as schema from "../../database/schema";

export type AlertType = "EXPIRY" | "REORDER" | "SYSTEM";

export interface RaiseAlertInput {
  type: AlertType;
  message: string;
  /** Batch or medicine the alert is about. Drives deduplication. */
  referenceId?: string;
  /** Branch that can act on it; omit only for genuinely system-wide alerts. */
  branchId?: string;
}

/**
 * Reads and writes system alerts.
 *
 * Nothing wrote to this table before — the nightly jobs collected expiry and
 * reorder lists, logged a count and discarded them, so `/alerts` was always
 * empty. Alerts are raised here now, addressed to the branch that holds the
 * stock, since a branch cannot act on another branch's shortage.
 */
@Injectable()
export class AlertsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
  }

  /**
   * Raises alerts, skipping any that already exist unread.
   *
   * Relies on system_alerts_open_uniq: a nightly scan re-reports the same
   * expiring batch every night, and without this the list would grow by one
   * duplicate per night until it was unusable. Once an alert is marked read the
   * next scan may legitimately raise it again.
   */
  async raiseMany(alerts: RaiseAlertInput[]) {
    if (alerts.length === 0) return 0;

    const inserted = await this.db
      .insert(schema.systemAlerts)
      .values(
        alerts.map((a) => ({
          type: a.type,
          message: a.message,
          referenceId: a.referenceId,
          branchId: a.branchId,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: schema.systemAlerts.id });

    return inserted.length;
  }

  /**
   * Alerts visible to a branch: its own, plus system-wide ones that belong to
   * no branch. `branchId` undefined means super_admin — everything.
   */
  async findVisible(params: {
    branchId?: string;
    type?: string;
    unreadOnly?: boolean;
    limit: number;
  }) {
    const conditions: any[] = [];
    if (params.type) conditions.push(eq(schema.systemAlerts.type, params.type));
    if (params.unreadOnly) conditions.push(eq(schema.systemAlerts.isRead, false));
    if (params.branchId) {
      conditions.push(
        or(
          eq(schema.systemAlerts.branchId, params.branchId),
          isNull(schema.systemAlerts.branchId),
        ),
      );
    }

    return this.db
      .select()
      .from(schema.systemAlerts)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.systemAlerts.createdAt))
      .limit(params.limit);
  }

  /**
   * Marks one alert read, but only if the caller's branch can see it. Returns
   * false when the alert belongs to another branch, so the caller can 404
   * rather than silently doing nothing.
   */
  async markRead(id: string, branchId?: string): Promise<boolean> {
    const conditions: any[] = [eq(schema.systemAlerts.id, id)];
    if (branchId) {
      conditions.push(
        or(
          eq(schema.systemAlerts.branchId, branchId),
          isNull(schema.systemAlerts.branchId),
        ),
      );
    }

    const updated = await this.db
      .update(schema.systemAlerts)
      .set({ isRead: true })
      .where(and(...conditions))
      .returning({ id: schema.systemAlerts.id });

    return updated.length > 0;
  }

  /** Clears the caller's own branch only — never another branch's queue. */
  async markAllRead(branchId?: string) {
    const conditions: any[] = [eq(schema.systemAlerts.isRead, false)];
    if (branchId) {
      conditions.push(
        or(
          eq(schema.systemAlerts.branchId, branchId),
          isNull(schema.systemAlerts.branchId),
        ),
      );
    }

    const updated = await this.db
      .update(schema.systemAlerts)
      .set({ isRead: true })
      .where(and(...conditions))
      .returning({ id: schema.systemAlerts.id });

    return updated.length;
  }

  /** Unread count per branch, for the header bell. */
  async unreadCount(branchId?: string) {
    const conditions: any[] = [eq(schema.systemAlerts.isRead, false)];
    if (branchId) {
      conditions.push(
        or(
          eq(schema.systemAlerts.branchId, branchId),
          isNull(schema.systemAlerts.branchId),
        ),
      );
    }

    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.systemAlerts)
      .where(and(...conditions));

    return row?.count ?? 0;
  }
}
