import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { DrizzleService } from "../../database/drizzle.service";
import * as schema from "../../database/schema";
import type { CreatePatientDto, UpdatePatientDto, QueryPatientDto } from "@pharmerp/types";

@Injectable()
export class PatientsRepository {
  constructor(private readonly drizzle: DrizzleService) {}
  private get db() { return this.drizzle.db; }

  async findPaginated(params: QueryPatientDto, doctorId?: string) {
    const conditions = [isNull(schema.patients.deletedAt)];
    if (doctorId) {
      conditions.push(
        sql`${schema.patients.id} IN (
          SELECT patient_id FROM clinic_tokens WHERE doctor_id = ${doctorId}::uuid
          UNION
          SELECT patient_id FROM prescriptions WHERE verified_by = ${doctorId}::uuid
        )`
      );
    }
    if (params.search) {
      const rawSearch = params.search.trim();
      const normalizedSearch = rawSearch.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
      const tokens = rawSearch.split(/\s+/).filter(Boolean);

      const tokenConditions = tokens.map((t) =>
        or(
          ilike(schema.patients.name, `%${t}%`),
          ilike(schema.patients.phone, `%${t}%`),
          ilike(schema.patients.insuranceId, `%${t}%`),
        ),
      );

      conditions.push(
        or(
          ilike(schema.patients.name, `%${rawSearch}%`),
          ilike(schema.patients.phone, `%${rawSearch}%`),
          ilike(schema.patients.insuranceId, `%${rawSearch}%`),
          ...(normalizedSearch
            ? [
                sql`LOWER(REGEXP_REPLACE(${schema.patients.name}, '[^a-zA-Z0-9]', '', 'g')) LIKE ${'%' + normalizedSearch + '%'}`,
                sql`REGEXP_REPLACE(${schema.patients.phone}, '[^0-9]', '', 'g') LIKE ${'%' + normalizedSearch + '%'}`,
              ]
            : []),
          ...(tokenConditions.length > 0 ? [and(...tokenConditions)] : []),
        ) as any,
      );
    }
    if (params.hasDues) {
      conditions.push(sql`${schema.patients.outstandingBalance} > 0`);
    }
    const where = and(...conditions);
    // A dues query is a collection worklist, so it leads with the largest
    // debt; every other listing is a roster and stays alphabetical.
    const orderBy = params.hasDues
      ? desc(schema.patients.outstandingBalance)
      : asc(schema.patients.name);
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
        .orderBy(orderBy)
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

  async isPatientServedByDoctor(patientId: string, doctorId: string): Promise<boolean> {
    const [tokenRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.clinicTokens)
      .where(and(eq(schema.clinicTokens.patientId, patientId), eq(schema.clinicTokens.doctorId, doctorId)));
    if ((tokenRow?.count ?? 0) > 0) return true;

    const [rxRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.prescriptions)
      .where(and(eq(schema.prescriptions.patientId, patientId), eq(schema.prescriptions.verifiedBy, doctorId)));
    return (rxRow?.count ?? 0) > 0;
  }

  async createDoctorTokenForPatient(patientId: string, doctorId: string, branchId?: string) {
    if (!branchId) return;
    const today = new Date().toISOString().slice(0, 10);
    const [maxRes] = await this.db
      .select({ maxToken: sql<number>`coalesce(max(${schema.clinicTokens.tokenNo}), 0)::int` })
      .from(schema.clinicTokens)
      .where(and(eq(schema.clinicTokens.doctorId, doctorId), eq(schema.clinicTokens.date, today)));
    const tokenNo = (maxRes?.maxToken ?? 0) + 1;

    try {
      await this.db.insert(schema.clinicTokens).values({
        tokenNo,
        patientId,
        doctorId,
        branchId,
        date: today,
        status: "pending",
      } as any);
    } catch {
      // Ignore if token already exists
    }
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

  /**
   * Takes back points a now-cancelled sale awarded, without ever refusing.
   *
   * deductLoyaltyPoints throws when the balance is short, which is right for a
   * redemption — a patient cannot spend points they do not have. It is wrong
   * for a void: if the patient has already spent the points elsewhere, refusing
   * here would abort the whole void and leave the sale standing. Clawing back
   * what remains and flooring at zero is the recoverable outcome.
   */
  async clawBackLoyaltyPoints(id: string, points: number, tx?: any) {
    const db = tx ?? this.db;
    await db.update(schema.patients)
      .set({
        loyaltyPoints: sql`GREATEST(${schema.patients.loyaltyPoints} - ${points}, 0)`,
      })
      .where(eq(schema.patients.id, id));
  }

  /** Called when an invoice is created with a partial payment: the un-paid
   *  balance becomes an amount the patient owes the pharmacy. Kept in sync
   *  with the same-transaction inserts on salesInvoices.amountDue so a rolled
   *  back invoice never leaves a phantom balance behind. */
  async addOutstanding(id: string, amount: string, tx?: any) {
    const db = tx ?? this.db;
    await db.update(schema.patients)
      .set({
        outstandingBalance: sql`${schema.patients.outstandingBalance} + ${amount}`,
        updatedAt: new Date(),
      })
      .where(eq(schema.patients.id, id));
  }

  /** Called when a later payment settles part or all of a prior due. Clamped
   *  at zero so a stray double-collection never drives the total negative
   *  (that would be a refund path, not a balance decrement). */
  async deductOutstanding(id: string, amount: string, tx?: any) {
    const db = tx ?? this.db;
    await db.update(schema.patients)
      .set({
        outstandingBalance: sql`GREATEST(${schema.patients.outstandingBalance} - ${amount}, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(schema.patients.id, id));
  }
}
