import { Injectable } from "@nestjs/common";
import { and, eq, desc, ilike, or, sql, type SQL } from "drizzle-orm";
import { DrizzleService } from "../../database/drizzle.service";
import * as schema from "../../database/schema";
import { UpdateUserDto } from "@pharmerp/types";

export interface InviteUserData {
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  branchId?: string | null;
  passwordHash: string;
  doctorProfile?: Record<string, any> | null;
}

export interface UserListFilters {
  search?: string;
  role?: string;
  /** Already resolved through resolveBranchScope — never a raw query param. */
  branchId?: string;
  isActive?: boolean;
  page?: number;
  limit?: number;
}

/** A drizzle transaction handle, or undefined to use the pool directly. */
type Tx = Parameters<Parameters<DrizzleService["db"]["transaction"]>[0]>[0];
type Executor = Tx | undefined;

@Injectable()
export class UsersRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
  }

  async findAll(filters: UserListFilters) {
    const { search, role, branchId, isActive, page = 1, limit = 20 } = filters;

    const cols = {
      id: schema.users.id,
      email: schema.users.email,
      firstName: schema.users.firstName,
      lastName: schema.users.lastName,
      role: schema.users.role,
      branchId: schema.users.branchId,
      // Left join: a super_admin legitimately has no branch, and an inner join
      // would hide exactly the accounts the admin console exists to manage.
      branchName: schema.branches.name,
      isActive: schema.users.isActive,
      doctorProfile: schema.users.doctorProfile,
      twoFaEnabled: schema.users.twoFaEnabled,
      lastLoginAt: schema.users.lastLoginAt,
      createdAt: schema.users.createdAt,
      updatedAt: schema.users.updatedAt,
    };

    const conditions: SQL[] = [];
    if (search) {
      const like = `%${search}%`;
      conditions.push(
        or(
          ilike(schema.users.email, like),
          ilike(schema.users.firstName, like),
          ilike(schema.users.lastName, like),
        )!,
      );
    }
    if (role) conditions.push(eq(schema.users.role, role as any));
    if (branchId) conditions.push(eq(schema.users.branchId, branchId));
    if (isActive !== undefined) {
      conditions.push(eq(schema.users.isActive, isActive));
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const [data, [countRow]] = await Promise.all([
      this.db
        .select(cols)
        .from(schema.users)
        .leftJoin(schema.branches, eq(schema.users.branchId, schema.branches.id))
        .where(where)
        .orderBy(desc(schema.users.createdAt))
        .limit(limit)
        .offset((page - 1) * limit),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.users)
        .where(where),
    ]);

    const total = countRow?.count ?? 0;
    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  async findById(id: string) {
    const [user] = await this.db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        firstName: schema.users.firstName,
        lastName: schema.users.lastName,
        role: schema.users.role,
        branchId: schema.users.branchId,
        isActive: schema.users.isActive,
        doctorProfile: schema.users.doctorProfile,
        lastLoginAt: schema.users.lastLoginAt,
        createdAt: schema.users.createdAt,
        updatedAt: schema.users.updatedAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, id));
    return user ?? null;
  }

  async findByEmail(email: string) {
    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email));
    return user ?? null;
  }

  async create(data: InviteUserData) {
    const [user] = await this.db
      .insert(schema.users)
      .values({
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        role: data.role as any,
        branchId: data.branchId ?? null,
        passwordHash: data.passwordHash,
        doctorProfile: data.doctorProfile ?? null,
        isActive: true,
      })
      .returning({
        id: schema.users.id,
        email: schema.users.email,
        firstName: schema.users.firstName,
        lastName: schema.users.lastName,
        role: schema.users.role,
        branchId: schema.users.branchId,
        isActive: schema.users.isActive,
        doctorProfile: schema.users.doctorProfile,
        createdAt: schema.users.createdAt,
      });
    return user;
  }

  /**
   * Number of super_admins that can still sign in. Guards against demoting or
   * deactivating the last one, which would lock everyone out of user admin.
   */
  async countActiveSuperAdmins(): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.role, "super_admin"),
          eq(schema.users.isActive, true),
        ),
      );
    return row?.count ?? 0;
  }

  /**
   * Runs a privileged write with every active super_admin row locked.
   *
   * The last-super-admin guard reads a count and then writes. Without the lock
   * a concurrent demote of the *other* super_admin slips between the two, both
   * transactions read a count of 2, both pass, and the system ends up with
   * zero super_admins and no in-app way back — reactivate is itself
   * super_admin-only. SELECT ... FOR UPDATE makes the second transaction wait
   * and re-read, so it sees 1 and is refused.
   *
   * "At least one row" cannot be expressed as a constraint, so the row lock is
   * the available tool.
   */
  async withSuperAdminLock<T>(
    fn: (activeSuperAdmins: number, tx: Executor) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      const locked = await tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(
          and(
            eq(schema.users.role, "super_admin"),
            eq(schema.users.isActive, true),
          ),
        )
        .for("update");
      return fn(locked.length, tx);
    });
  }

  async update(id: string, data: UpdateUserDto, tx?: Executor) {
    // Build the patch explicitly. Spreading the DTO let unvalidated keys reach
    // the column list, and `role: undefined` on a partial update is only
    // ignored by accident rather than by intent.
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (data.firstName !== undefined) patch.firstName = data.firstName;
    if (data.lastName !== undefined) patch.lastName = data.lastName;
    if (data.role !== undefined) patch.role = data.role;
    if (data.branchId !== undefined) patch.branchId = data.branchId;
    if (data.isActive !== undefined) patch.isActive = data.isActive;
    if (data.doctorProfile !== undefined) patch.doctorProfile = data.doctorProfile;

    const [user] = await (tx ?? this.db)
      .update(schema.users)
      .set(patch)
      .where(eq(schema.users.id, id))
      .returning({
        id: schema.users.id,
        email: schema.users.email,
        firstName: schema.users.firstName,
        lastName: schema.users.lastName,
        role: schema.users.role,
        branchId: schema.users.branchId,
        isActive: schema.users.isActive,
        doctorProfile: schema.users.doctorProfile,
        updatedAt: schema.users.updatedAt,
      });
    return user ?? null;
  }

  async setActive(id: string, isActive: boolean, tx?: Executor) {
    const [user] = await (tx ?? this.db)
      .update(schema.users)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(schema.users.id, id))
      .returning({ id: schema.users.id, isActive: schema.users.isActive });
    return user ?? null;
  }

  async changeRole(id: string, role: string, tx?: Executor) {
    const [user] = await (tx ?? this.db)
      .update(schema.users)
      .set({ role: role as any, updatedAt: new Date() })
      .where(eq(schema.users.id, id))
      .returning({
        id: schema.users.id,
        email: schema.users.email,
        role: schema.users.role,
        updatedAt: schema.users.updatedAt,
      });
    return user ?? null;
  }

  async getNotificationPrefs(userId: string) {
    const user = await this.db.query.users.findFirst({
      where: eq(schema.users.id, userId),
      columns: { notificationPrefs: true },
    });
    return user?.notificationPrefs ?? null;
  }

  async updateNotificationPrefs(userId: string, prefs: Record<string, { email: boolean; sms: boolean }>) {
    await this.db
      .update(schema.users)
      .set({ notificationPrefs: prefs, updatedAt: new Date() })
      .where(eq(schema.users.id, userId));
  }
}
