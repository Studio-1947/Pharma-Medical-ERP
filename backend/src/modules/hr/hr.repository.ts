import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, ilike, isNull, lte, or, sql } from "drizzle-orm";
import { DrizzleService } from "../../database/drizzle.service";
import * as schema from "../../database/schema";
import type {
  CreateEmployeeDto,
  UpdateEmployeeDto,
  QueryEmployeeDto,
  RecordAttendanceDto,
  CreateLeaveRequestDto,
  UpdateLeaveRequestDto,
  ReviewLeaveDto,
} from "@pharmerp/types";

@Injectable()
export class HrRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
  }

  // ─── Employees ────────────────────────────────────────────────────────────────

  async findAllEmployees(params: QueryEmployeeDto) {
    const conditions = [isNull(schema.employees.deletedAt)];

    if (params.branchId) {
      conditions.push(eq(schema.employees.branchId, params.branchId));
    }
    if (params.departmentId) {
      conditions.push(eq(schema.employees.departmentId, params.departmentId));
    }
    if (params.isActive !== undefined) {
      conditions.push(eq(schema.employees.isActive, params.isActive));
    }
    if (params.search) {
      conditions.push(
        or(
          ilike(schema.employees.firstName, `%${params.search}%`),
          ilike(schema.employees.lastName, `%${params.search}%`),
          ilike(schema.employees.employeeCode, `%${params.search}%`),
        ) as any,
      );
    }

    const where = and(...conditions);

    const [items, [countRow]] = await Promise.all([
      this.db
        .select()
        .from(schema.employees)
        .where(where)
        .orderBy(asc(schema.employees.firstName))
        .limit(params.limit)
        .offset((params.page - 1) * params.limit),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.employees)
        .where(where),
    ]);

    return {
      data: items,
      meta: {
        page: params.page,
        limit: params.limit,
        total: countRow?.count ?? 0,
        totalPages: Math.ceil((countRow?.count ?? 0) / params.limit),
      },
    };
  }

  async findEmployeeById(id: string) {
    return this.db.query.employees.findFirst({
      where: and(eq(schema.employees.id, id), isNull(schema.employees.deletedAt)),
      with: {
        user: {
          columns: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true },
        },
        department: true,
      },
    });
  }

  async findByUserId(userId: string) {
    return this.db.query.employees.findFirst({
      where: and(eq(schema.employees.userId, userId), isNull(schema.employees.deletedAt)),
    });
  }

  async createEmployee(data: CreateEmployeeDto) {
    const [employee] = await this.db
      .insert(schema.employees)
      .values(data as any)
      .returning();
    return employee!;
  }

  async updateEmployee(id: string, data: UpdateEmployeeDto) {
    const [employee] = await this.db
      .update(schema.employees)
      .set({ ...(data as any), updatedAt: new Date() })
      .where(eq(schema.employees.id, id))
      .returning();
    return employee!;
  }

  async deactivateEmployee(id: string) {
    await this.db
      .update(schema.employees)
      .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.employees.id, id));
  }

  // ─── Departments ──────────────────────────────────────────────────────────────

  async findAllDepartments(branchId?: string) {
    const conditions = branchId ? [eq(schema.departments.branchId, branchId)] : [];
    const where = conditions.length ? and(...conditions) : undefined;
    return this.db
      .select()
      .from(schema.departments)
      .where(where)
      .orderBy(asc(schema.departments.name));
  }

  async createDepartment(data: { name: string; branchId: string; managerId?: string }) {
    const [dept] = await this.db.insert(schema.departments).values(data).returning();
    return dept!;
  }

  // ─── Attendance ───────────────────────────────────────────────────────────────

  async recordAttendance(data: RecordAttendanceDto) {
    // Upsert by employeeId + date
    const existing = await this.db.query.attendance.findFirst({
      where: and(
        eq(schema.attendance.employeeId, data.employeeId),
        eq(schema.attendance.date, data.date),
      ),
    });

    if (existing) {
      const [updated] = await this.db
        .update(schema.attendance)
        .set({
          checkIn: data.checkIn ? new Date(data.checkIn) : existing.checkIn,
          checkOut: data.checkOut ? new Date(data.checkOut) : existing.checkOut,
          status: data.status as any,
          notes: data.notes ?? existing.notes,
        })
        .where(eq(schema.attendance.id, existing.id))
        .returning();
      return updated!;
    }

    const [record] = await this.db
      .insert(schema.attendance)
      .values({
        employeeId: data.employeeId,
        date: data.date,
        checkIn: data.checkIn ? new Date(data.checkIn) : undefined,
        checkOut: data.checkOut ? new Date(data.checkOut) : undefined,
        status: data.status as any,
        notes: data.notes,
      })
      .returning();
    return record!;
  }

  async findAttendance(employeeId: string, from: string, to: string) {
    return this.db
      .select()
      .from(schema.attendance)
      .where(
        and(
          eq(schema.attendance.employeeId, employeeId),
          gte(schema.attendance.date, from),
          lte(schema.attendance.date, to),
        ),
      )
      .orderBy(asc(schema.attendance.date));
  }

  // ─── Leave Requests ───────────────────────────────────────────────────────────

  async createLeaveRequest(data: CreateLeaveRequestDto) {
    const [leave] = await this.db
      .insert(schema.leaveRequests)
      .values({
        employeeId: data.employeeId,
        leaveType: data.leaveType,
        startDate: data.startDate,
        endDate: data.endDate,
        days: data.days,
        reason: data.reason,
        status: "pending",
      })
      .returning();
    return leave!;
  }

  async findLeaveRequests(params: {
    employeeId?: string;
    status?: string;
    branchId?: string;
  }) {
    const conditions: any[] = [];

    if (params.employeeId) {
      conditions.push(eq(schema.leaveRequests.employeeId, params.employeeId));
    }
    if (params.status) {
      conditions.push(eq(schema.leaveRequests.status, params.status as any));
    }

    const where = conditions.length ? and(...conditions) : undefined;

    return this.db
      .select()
      .from(schema.leaveRequests)
      .where(where)
      .orderBy(desc(schema.leaveRequests.createdAt));
  }

  async findLeaveById(id: string) {
    return this.db.query.leaveRequests.findFirst({
      where: eq(schema.leaveRequests.id, id),
    });
  }

  async deleteLeaveRequest(id: string) {
    await this.db
      .delete(schema.leaveRequests)
      .where(eq(schema.leaveRequests.id, id));
  }

  async updateLeaveRequest(id: string, dto: UpdateLeaveRequestDto) {
    const [updated] = await this.db
      .update(schema.leaveRequests)
      .set(dto as any)
      .where(eq(schema.leaveRequests.id, id))
      .returning();
    return updated!;
  }

  async reviewLeave(id: string, dto: ReviewLeaveDto, reviewedBy: string) {
    const [updated] = await this.db
      .update(schema.leaveRequests)
      .set({
        status: dto.status as any,
        reviewedBy,
        reviewedAt: new Date(),
        reviewNote: dto.reviewNote,
      })
      .where(eq(schema.leaveRequests.id, id))
      .returning();
    return updated!;
  }
}
