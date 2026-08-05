import { Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
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

// The consultation view needs identity plus the clinical fields a doctor acts
// on. Everything else on the patients row — address, insuranceId,
// insuranceExpiry, outstandingBalance, loyaltyPoints, notes, email — is
// commercial or contact PII with no bearing on the queue, so it stays out of
// the response entirely rather than being filtered in the UI.
const PATIENT_PUBLIC_COLUMNS = {
  id: true,
  name: true,
  phone: true,
  gender: true,
  dateOfBirth: true,
  bloodGroup: true,
  allergies: true,
} as const;

const OPEN_STATUSES = ["pending", "called"] as const;

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
    // An undefined branchId reaches here only for super_admin (see
    // resolveBranchScope), so leaving the filter off is the intended
    // all-branches read rather than a missing check.
    if (params.branchId) conditions.push(eq(schema.clinicTokens.branchId, params.branchId));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, [countRow]] = await Promise.all([
      this.db.query.clinicTokens.findMany({
        where,
        with: {
          patient: { columns: PATIENT_PUBLIC_COLUMNS },
          doctor: { columns: DOCTOR_PUBLIC_COLUMNS },
          prescription: true,
        },
        orderBy: [asc(schema.clinicTokens.date), asc(schema.clinicTokens.tokenNo)],
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
        patient: { columns: PATIENT_PUBLIC_COLUMNS },
        doctor: { columns: DOCTOR_PUBLIC_COLUMNS },
        prescription: { with: { items: true } },
      },
    });
  }

  async create(data: CreateClinicTokenDto & { branchId: string }) {
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
          branchId: data.branchId,
          date: data.date,
          timeSlot: data.timeSlot,
          notes: data.notes,
          status: "pending",
        })
        .returning();

      return token!;
    });
  }

  /**
   * `calledAt`/`completedAt` are not part of UpdateClinicTokenDto on purpose —
   * they are derived by the service from the status transition, never accepted
   * from the request body.
   */
  async update(
    id: string,
    data: UpdateClinicTokenDto & { calledAt?: Date; completedAt?: Date },
  ) {
    const [token] = await this.db
      .update(schema.clinicTokens)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.clinicTokens.id, id))
      .returning();
    return token!;
  }

  async findDoctors(branchId?: string) {
    const conditions = [
      eq(schema.users.role, "doctor"),
      eq(schema.users.isActive, true),
    ];
    if (branchId) conditions.push(eq(schema.users.branchId, branchId));

    return this.db
      .select({
        id: schema.users.id,
        firstName: schema.users.firstName,
        lastName: schema.users.lastName,
        email: schema.users.email,
      })
      .from(schema.users)
      .where(and(...conditions))
      .orderBy(asc(schema.users.firstName));
  }

  async findActiveDoctor(id: string) {
    return this.db.query.users.findFirst({
      columns: { id: true, firstName: true, lastName: true, branchId: true },
      where: and(
        eq(schema.users.id, id),
        eq(schema.users.role, "doctor"),
        eq(schema.users.isActive, true),
      ),
    });
  }

  /** Patient a prescription belongs to — used to reject cross-patient links. */
  async findPrescriptionPatientId(id: string) {
    const row = await this.db.query.prescriptions.findFirst({
      columns: { id: true, patientId: true },
      where: eq(schema.prescriptions.id, id),
    });
    return row ?? null;
  }

  /** An unfinished token this patient already holds with this doctor that day. */
  async findOpenTokenForPatient(
    patientId: string,
    doctorId: string,
    date: string,
    excludeTokenId?: string,
  ) {
    const conditions = [
      eq(schema.clinicTokens.patientId, patientId),
      eq(schema.clinicTokens.doctorId, doctorId),
      eq(schema.clinicTokens.date, date),
      inArray(schema.clinicTokens.status, [...OPEN_STATUSES]),
    ];
    if (excludeTokenId) conditions.push(ne(schema.clinicTokens.id, excludeTokenId));

    return this.db.query.clinicTokens.findFirst({
      columns: { id: true, tokenNo: true },
      where: and(...conditions),
    });
  }

  /**
   * The token already occupying a doctor's slot on a date, if any.
   *
   * Mirrors clinic_tokens_doctor_date_slot_uniq so the caller can refuse with a
   * message naming the clash instead of surfacing a raw constraint violation.
   * Cancelled tokens are excluded — cancelling frees the slot.
   */
  async findTokenAtSlot(
    doctorId: string,
    date: string,
    timeSlot: string,
    excludeTokenId?: string,
  ) {
    const conditions = [
      eq(schema.clinicTokens.doctorId, doctorId),
      eq(schema.clinicTokens.date, date),
      eq(schema.clinicTokens.timeSlot, timeSlot),
      ne(schema.clinicTokens.status, "cancelled"),
    ];
    if (excludeTokenId) conditions.push(ne(schema.clinicTokens.id, excludeTokenId));

    return this.db.query.clinicTokens.findFirst({
      columns: { id: true, tokenNo: true },
      with: { patient: { columns: { name: true } } },
      where: and(...conditions),
    });
  }

  /** Slots already taken for a doctor on a date, so the UI can grey them out. */
  async findTakenSlots(doctorId: string, date: string) {
    const rows = await this.db
      .select({
        timeSlot: schema.clinicTokens.timeSlot,
        tokenNo: schema.clinicTokens.tokenNo,
      })
      .from(schema.clinicTokens)
      .where(
        and(
          eq(schema.clinicTokens.doctorId, doctorId),
          eq(schema.clinicTokens.date, date),
          ne(schema.clinicTokens.status, "cancelled"),
          isNotNull(schema.clinicTokens.timeSlot),
        ),
      );
    return rows;
  }

  /** Guards against issuing a token to a soft-deleted patient. */
  async findLivePatient(id: string) {
    return this.db.query.patients.findFirst({
      columns: { id: true, name: true },
      where: and(eq(schema.patients.id, id), isNull(schema.patients.deletedAt)),
    });
  }
}
