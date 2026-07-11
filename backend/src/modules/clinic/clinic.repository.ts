import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { DrizzleService } from "../../database/drizzle.service";
import * as schema from "../../database/schema";
import type {
  CreateClinicTokenDto,
  UpdateClinicTokenDto,
  QueryClinicTokenDto,
} from "@pharmerp/types";

// Only non-sensitive doctor fields may cross the API boundary. Never spread the
// full users row into responses: it carries passwordHash and twoFaSecret.
const DOCTOR_PUBLIC_COLUMNS = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
} as const;

@Injectable()
export class ClinicRepository {
  constructor(private readonly drizzle: DrizzleService) {}
  private get db() {
    return this.drizzle.db;
  }

  async findPaginated(params: QueryClinicTokenDto) {
    const conditions = [];
    if (params.date) conditions.push(eq(schema.clinicTokens.date, params.date));
    if (params.doctorId) conditions.push(eq(schema.clinicTokens.doctorId, params.doctorId));
    if (params.patientId) conditions.push(eq(schema.clinicTokens.patientId, params.patientId));
    if (params.status) conditions.push(eq(schema.clinicTokens.status, params.status));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, [countRow]] = await Promise.all([
      this.db.query.clinicTokens.findMany({
        where,
        with: {
          patient: true,
          doctor: { columns: DOCTOR_PUBLIC_COLUMNS },
          prescription: true,
        },
        orderBy: [asc(schema.clinicTokens.tokenNo)],
        limit: params.limit,
        offset: (params.page - 1) * params.limit,
      }),
      this.db.select({ count: sql<number>`count(*)::int` }).from(schema.clinicTokens).where(where),
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

  async findById(id: string) {
    return this.db.query.clinicTokens.findFirst({
      where: eq(schema.clinicTokens.id, id),
      with: {
        patient: true,
        doctor: { columns: DOCTOR_PUBLIC_COLUMNS },
        prescription: { with: { items: true } },
      },
    });
  }

  async create(data: CreateClinicTokenDto) {
    return this.db.transaction(async (tx) => {
      // Serialize concurrent token generation for the same doctor+date so two
      // receptionists can't compute the same tokenNo and collide on the unique index.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`${data.doctorId}:${data.date}`}))`,
      );

      const [{ maxToken } = { maxToken: 0 }] = await tx
        .select({ maxToken: sql<number>`coalesce(max(${schema.clinicTokens.tokenNo}), 0)::int` })
        .from(schema.clinicTokens)
        .where(and(eq(schema.clinicTokens.doctorId, data.doctorId), eq(schema.clinicTokens.date, data.date)));

      const [token] = await tx
        .insert(schema.clinicTokens)
        .values({
          tokenNo: maxToken + 1,
          patientId: data.patientId,
          doctorId: data.doctorId,
          date: data.date,
          timeSlot: data.timeSlot,
          notes: data.notes,
          status: "pending",
        })
        .returning();

      return token!;
    });
  }

  async update(id: string, data: UpdateClinicTokenDto) {
    const [token] = await this.db
      .update(schema.clinicTokens)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.clinicTokens.id, id))
      .returning();
    return token!;
  }

  async findDoctors() {
    return this.db
      .select({
        id: schema.users.id,
        firstName: schema.users.firstName,
        lastName: schema.users.lastName,
        email: schema.users.email,
      })
      .from(schema.users)
      .where(and(eq(schema.users.role, "doctor"), eq(schema.users.isActive, true)))
      .orderBy(asc(schema.users.firstName));
  }

  async findActiveDoctor(id: string) {
    return this.db.query.users.findFirst({
      columns: { id: true, firstName: true, lastName: true },
      where: and(
        eq(schema.users.id, id),
        eq(schema.users.role, "doctor"),
        eq(schema.users.isActive, true),
      ),
    });
  }
}
