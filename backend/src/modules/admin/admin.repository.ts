import { Injectable } from "@nestjs/common";
import {
  and,
  desc,
  eq,
  gt,
  gte,
  isNull,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";
import { DrizzleService } from "../../database/drizzle.service";
import * as schema from "../../database/schema";
import type { AuditLogQueryDto, SessionQueryDto } from "@pharmerp/types";

/**
 * Reads the developer console needs that no other repository owns: the audit
 * log, the session list, and the system overview.
 *
 * Deliberately not branch-scoped, which is why every route reaching it is
 * pinned to super_admin at the controller. Users and branches are NOT here —
 * those reuse the existing /users and /branches endpoints, which super_admin
 * already passes through RolesGuard.
 */
@Injectable()
export class AdminRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
  }

  // ----------------------------------------------------------- audit logs

  async listAuditLogs(q: AuditLogQueryDto) {
    const conditions: SQL[] = [];
    if (q.userId) conditions.push(eq(schema.auditLogs.userId, q.userId));
    if (q.action) conditions.push(eq(schema.auditLogs.action, q.action));
    if (q.entity) conditions.push(eq(schema.auditLogs.entity, q.entity));
    if (q.entityId) conditions.push(eq(schema.auditLogs.entityId, q.entityId));

    // An unparseable date would become an invalid comparison and silently
    // widen the range instead of narrowing it.
    const from = parseDate(q.from);
    const to = parseDate(q.to);
    if (from) conditions.push(gte(schema.auditLogs.createdAt, from));
    if (to) conditions.push(lte(schema.auditLogs.createdAt, to));

    const where = conditions.length ? and(...conditions) : undefined;
    const page = q.page ?? 1;
    const limit = q.limit ?? 50;

    const [rows, [countRow]] = await Promise.all([
      this.db
        .select({
          id: schema.auditLogs.id,
          action: schema.auditLogs.action,
          entity: schema.auditLogs.entity,
          entityId: schema.auditLogs.entityId,
          oldValue: schema.auditLogs.oldValue,
          newValue: schema.auditLogs.newValue,
          ipAddress: schema.auditLogs.ipAddress,
          userAgent: schema.auditLogs.userAgent,
          createdAt: schema.auditLogs.createdAt,
          actorId: schema.auditLogs.userId,
          actorEmail: schema.users.email,
          actorFirstName: schema.users.firstName,
          actorLastName: schema.users.lastName,
          actorRole: schema.users.role,
        })
        .from(schema.auditLogs)
        // Left join: audit_logs.user_id is ON DELETE SET NULL, so an inner
        // join would drop the history of any deleted account — the rows most
        // worth keeping.
        .leftJoin(schema.users, eq(schema.auditLogs.userId, schema.users.id))
        .where(where)
        .orderBy(desc(schema.auditLogs.createdAt))
        .limit(limit)
        .offset((page - 1) * limit),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.auditLogs)
        .where(where),
    ]);

    const data = rows.map((r) => ({
      id: r.id,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      oldValue: r.oldValue,
      newValue: r.newValue,
      ipAddress: r.ipAddress,
      userAgent: r.userAgent,
      createdAt: r.createdAt,
      actor: r.actorId
        ? {
            id: r.actorId,
            email: r.actorEmail,
            firstName: r.actorFirstName,
            lastName: r.actorLastName,
            role: r.actorRole,
          }
        : null,
    }));

    const total = countRow?.count ?? 0;
    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  /** Distinct action values actually present, for the filter dropdown. */
  async listAuditActions(): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ action: schema.auditLogs.action })
      .from(schema.auditLogs)
      .orderBy(schema.auditLogs.action);
    return rows.map((r) => r.action);
  }

  // ------------------------------------------------------------- sessions

  async listSessions(q: SessionQueryDto) {
    const now = new Date();
    const conditions: SQL[] = [];
    if (q.userId) conditions.push(eq(schema.refreshTokens.userId, q.userId));
    if (!q.includeInactive) {
      // Exactly the predicate AuthRepository.findValidRefreshToken uses, so
      // "active" here means the same thing it means at authentication time.
      conditions.push(isNull(schema.refreshTokens.revokedAt));
      conditions.push(gt(schema.refreshTokens.expiresAt, now));
    }

    const where = conditions.length ? and(...conditions) : undefined;
    const page = q.page ?? 1;
    const limit = q.limit ?? 50;

    const [rows, [countRow]] = await Promise.all([
      this.db
        .select({
          id: schema.refreshTokens.id,
          userId: schema.refreshTokens.userId,
          email: schema.users.email,
          firstName: schema.users.firstName,
          lastName: schema.users.lastName,
          role: schema.users.role,
          branchId: schema.users.branchId,
          ipAddress: schema.refreshTokens.ipAddress,
          userAgent: schema.refreshTokens.userAgent,
          createdAt: schema.refreshTokens.createdAt,
          expiresAt: schema.refreshTokens.expiresAt,
          revokedAt: schema.refreshTokens.revokedAt,
        })
        // tokenHash is never selected: it is the SHA-256 of the bearer secret.
        .from(schema.refreshTokens)
        .leftJoin(schema.users, eq(schema.refreshTokens.userId, schema.users.id))
        .where(where)
        .orderBy(desc(schema.refreshTokens.createdAt))
        .limit(limit)
        .offset((page - 1) * limit),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.refreshTokens)
        .where(where),
    ]);

    const data = rows.map((r) => ({
      ...r,
      isActive: r.revokedAt === null && r.expiresAt > now,
    }));

    const total = countRow?.count ?? 0;
    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  async findSessionById(id: string) {
    const [row] = await this.db
      .select({
        id: schema.refreshTokens.id,
        userId: schema.refreshTokens.userId,
        revokedAt: schema.refreshTokens.revokedAt,
        expiresAt: schema.refreshTokens.expiresAt,
      })
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.id, id));
    return row ?? null;
  }

  // ------------------------------------------------------------- overview

  /**
   * Counts for the console landing page.
   *
   * Exact counts rather than estimates: at this data size they are cheap, and
   * a dashboard whose numbers disagree with the list screens is worse than no
   * dashboard.
   */
  async getOverview() {
    const now = new Date();
    const in30Days = new Date(now.getTime() + 30 * 86_400_000);
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const last24h = new Date(now.getTime() - 86_400_000);

    const count = async (table: any, where?: SQL) => {
      const [row] = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(table)
        .where(where);
      return row?.n ?? 0;
    };

    const [
      usersTotal,
      usersActive,
      superAdmins,
      branchesTotal,
      branchesActive,
      sessionsActive,
      auditTotal,
      auditLast24h,
      medicines,
      medicinesActive,
      batches,
      batchesExpiring,
      invoices,
      invoicesToday,
      patients,
      employees,
      suppliers,
      prescriptions,
      purchaseOrders,
      byRole,
    ] = await Promise.all([
      count(schema.users),
      count(schema.users, eq(schema.users.isActive, true)),
      count(
        schema.users,
        and(
          eq(schema.users.role, "super_admin"),
          eq(schema.users.isActive, true),
        ),
      ),
      count(schema.branches),
      count(schema.branches, eq(schema.branches.isActive, true)),
      count(
        schema.refreshTokens,
        and(
          isNull(schema.refreshTokens.revokedAt),
          gt(schema.refreshTokens.expiresAt, now),
        ),
      ),
      count(schema.auditLogs),
      count(schema.auditLogs, gte(schema.auditLogs.createdAt, last24h)),
      count(schema.medicines),
      count(schema.medicines, eq(schema.medicines.isActive, true)),
      count(schema.inventoryBatches),
      count(
        schema.inventoryBatches,
        and(
          eq(schema.inventoryBatches.status, "active"),
          lte(
            schema.inventoryBatches.expiryDate,
            in30Days.toISOString().slice(0, 10),
          ),
        ),
      ),
      count(schema.salesInvoices),
      count(schema.salesInvoices, gte(schema.salesInvoices.createdAt, startOfToday)),
      count(schema.patients),
      count(schema.employees),
      count(schema.suppliers),
      count(schema.prescriptions),
      count(schema.purchaseOrders),
      this.db
        .select({
          role: schema.users.role,
          total: sql<number>`count(*)::int`,
          active: sql<number>`count(*) filter (where is_active)::int`,
        })
        .from(schema.users)
        .groupBy(schema.users.role)
        .orderBy(schema.users.role),
    ]);

    return {
      users: {
        total: usersTotal,
        active: usersActive,
        inactive: usersTotal - usersActive,
        superAdmins,
        byRole,
      },
      branches: { total: branchesTotal, active: branchesActive },
      sessions: { active: sessionsActive },
      audit: { total: auditTotal, last24h: auditLast24h },
      catalogue: { medicines, activeMedicines: medicinesActive },
      inventory: { batches, expiringIn30Days: batchesExpiring },
      billing: { invoices, invoicesToday },
      people: { patients, employees, suppliers },
      clinical: { prescriptions },
      procurement: { purchaseOrders },
    };
  }
}

function parseDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
