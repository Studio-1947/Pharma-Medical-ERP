import { Injectable } from "@nestjs/common";
import { and, asc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { DrizzleService } from "../../database/drizzle.service";
import * as schema from "../../database/schema";
import type { CreatePatientDto, UpdatePatientDto, QueryPatientDto } from "@pharmerp/types";

@Injectable()
export class PatientsRepository {
  constructor(private readonly drizzle: DrizzleService) {}
  private get db() { return this.drizzle.db; }

  async findPaginated(params: QueryPatientDto) {
    const conditions = [isNull(schema.patients.deletedAt)];
    if (params.search) {
      conditions.push(
        or(
          ilike(schema.patients.name, `%${params.search}%`),
          ilike(schema.patients.phone, `%${params.search}%`),
        ) as any,
      );
    }
    const where = and(...conditions);
    const [items, [countRow]] = await Promise.all([
      this.db
        .select({
          id: schema.patients.id,
          name: schema.patients.name,
          phone: schema.patients.phone,
          email: schema.patients.email,
          gender: schema.patients.gender,
          bloodGroup: schema.patients.bloodGroup,
          allergies: schema.patients.allergies,
          loyaltyPoints: schema.patients.loyaltyPoints,
          outstandingBalance: schema.patients.outstandingBalance,
          isActive: schema.patients.isActive,
          createdAt: schema.patients.createdAt,
        })
        .from(schema.patients)
        .where(where)
        .orderBy(asc(schema.patients.name))
        .limit(params.limit)
        .offset((params.page - 1) * params.limit),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.patients)
        .where(where),
    ]);
    return {
      data: items,
      meta: { page: params.page, limit: params.limit, total: countRow?.count ?? 0, totalPages: Math.ceil((countRow?.count ?? 0) / params.limit) },
    };
  }

  async findById(id: string) {
    return this.db.query.patients.findFirst({ where: and(eq(schema.patients.id, id), isNull(schema.patients.deletedAt)) });
  }

  async findByPhone(phone: string) {
    return this.db.query.patients.findFirst({ where: and(eq(schema.patients.phone, phone), isNull(schema.patients.deletedAt)) });
  }

  async create(data: CreatePatientDto) {
    const [p] = await this.db.insert(schema.patients).values(data as any).returning();
    return p!;
  }

  async update(id: string, data: UpdatePatientDto) {
    const [p] = await this.db.update(schema.patients).set({ ...(data as any), updatedAt: new Date() }).where(eq(schema.patients.id, id)).returning();
    return p!;
  }

  async softDelete(id: string) {
    await this.db.update(schema.patients).set({ deletedAt: new Date(), isActive: false }).where(eq(schema.patients.id, id));
  }

  async addLoyaltyPoints(id: string, points: number, tx?: any) {
    const db = tx ?? this.db;
    await db.update(schema.patients)
      .set({ loyaltyPoints: sql`${schema.patients.loyaltyPoints} + ${points}` })
      .where(eq(schema.patients.id, id));
  }

  async deductLoyaltyPoints(id: string, points: number, tx?: any) {
    const db = tx ?? this.db;
    const [patient] = await db
      .select({ loyaltyPoints: schema.patients.loyaltyPoints })
      .from(schema.patients)
      .where(eq(schema.patients.id, id));
    if (!patient || patient.loyaltyPoints < points) {
      throw new Error(`Insufficient loyalty points. Available: ${patient?.loyaltyPoints ?? 0}`);
    }
    await db.update(schema.patients)
      .set({ loyaltyPoints: sql`${schema.patients.loyaltyPoints} - ${points}` })
      .where(eq(schema.patients.id, id));
  }
}
