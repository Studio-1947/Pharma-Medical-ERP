import { Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { DrizzleService } from "../../database/drizzle.service";
import * as schema from "../../database/schema";
import { allocateTokenNo } from "./allocate-token-no";
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
      // Shared with the doctor's register-a-patient shortcut; it takes the
      // advisory lock that keeps the numbering sequential under concurrency.
      const tokenNo = await allocateTokenNo(tx, data.doctorId, data.date);

      const [token] = await tx
        .insert(schema.clinicTokens)
        .values({
          tokenNo,
          patientId: data.patientId,
          doctorId: data.doctorId,
          branchId: data.branchId,
          date: data.date,
          timeSlot: data.timeSlot,
          visitType: data.visitType ?? "new",
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
        branchId: schema.users.branchId,
        branchName: schema.branches.name,
        doctorProfile: schema.users.doctorProfile,
      })
      .from(schema.users)
      .leftJoin(schema.branches, eq(schema.users.branchId, schema.branches.id))
      .where(and(...conditions))
      .orderBy(asc(schema.users.firstName));
  }

  async updateDoctorProfile(id: string, payload: { branchId?: string | null; firstName?: string; lastName?: string; doctorProfile: Record<string, any> }) {
    const updateData: Record<string, any> = {
      doctorProfile: payload.doctorProfile,
      updatedAt: new Date(),
    };
    if (payload.branchId !== undefined) {
      updateData.branchId = payload.branchId;
    }
    if (payload.firstName !== undefined && payload.firstName !== null) {
      updateData.firstName = payload.firstName;
    }
    if (payload.lastName !== undefined && payload.lastName !== null) {
      updateData.lastName = payload.lastName;
    }

    const [user] = await this.db
      .update(schema.users)
      .set(updateData)
      .where(and(eq(schema.users.id, id), eq(schema.users.role, "doctor")))
      .returning({
        id: schema.users.id,
        firstName: schema.users.firstName,
        lastName: schema.users.lastName,
        email: schema.users.email,
        branchId: schema.users.branchId,
        doctorProfile: schema.users.doctorProfile,
      });
    return user ?? null;
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

  // ── Doctor medicine list ───────────────────────────────────────────────────

  /**
   * A doctor's curated medicine list, joined to the catalogue and to live stock
   * for whichever branch is asking.
   *
   * `branchId` only narrows the stock sum, never the list itself: the list
   * belongs to the doctor, so a branch with no stock of a listed medicine still
   * sees the row — with totalStock 0, which is exactly what the counter needs
   * to know. Soft-deleted medicines are dropped; a store manager retiring a
   * catalogue entry should remove it from every doctor's list at once.
   */
  async listDoctorMedicines(doctorId: string, branchId?: string) {
    const stockConditions = [
      eq(schema.medicines.id, schema.inventoryBatches.medicineId),
      eq(schema.inventoryBatches.status, "active"),
    ];
    if (branchId) {
      stockConditions.push(eq(schema.inventoryBatches.branchId, branchId));
    }

    return this.db
      .select({
        id: schema.doctorMedicines.id,
        doctorId: schema.doctorMedicines.doctorId,
        medicineId: schema.doctorMedicines.medicineId,
        defaultDosage: schema.doctorMedicines.defaultDosage,
        defaultFrequency: schema.doctorMedicines.defaultFrequency,
        defaultDuration: schema.doctorMedicines.defaultDuration,
        defaultQuantity: schema.doctorMedicines.defaultQuantity,
        notes: schema.doctorMedicines.notes,
        sortOrder: schema.doctorMedicines.sortOrder,
        isActive: schema.doctorMedicines.isActive,
        createdAt: schema.doctorMedicines.createdAt,
        // Catalogue fields the counter desk needs to put a line on a bill
        // without a second round trip.
        name: schema.medicines.name,
        brandName: schema.medicines.brandName,
        genericName: schema.medicines.genericName,
        strength: schema.medicines.strength,
        dosageForm: schema.medicines.dosageForm,
        sku: schema.medicines.sku,
        manufacturer: schema.medicines.manufacturer,
        unit: schema.medicines.unit,
        stripSize: schema.medicines.stripSize,
        priceMrp: schema.medicines.priceMrp,
        taxPercent: schema.medicines.taxPercent,
        requiresPrescription: schema.medicines.requiresPrescription,
        isControlled: schema.medicines.isControlled,
        scheduleClass: schema.medicines.scheduleClass,
        drawerMapping: schema.medicines.drawerMapping,
        medicineIsActive: schema.medicines.isActive,
        totalStock: sql<number>`COALESCE(SUM(${schema.inventoryBatches.quantity}), 0)`,
      })
      .from(schema.doctorMedicines)
      .innerJoin(
        schema.medicines,
        eq(schema.doctorMedicines.medicineId, schema.medicines.id),
      )
      .leftJoin(schema.inventoryBatches, and(...stockConditions))
      .where(
        and(
          eq(schema.doctorMedicines.doctorId, doctorId),
          isNull(schema.doctorMedicines.deletedAt),
          isNull(schema.medicines.deletedAt),
        ),
      )
      .groupBy(schema.doctorMedicines.id, schema.medicines.id)
      .orderBy(asc(schema.doctorMedicines.sortOrder), asc(schema.medicines.name));
  }

  /** Live catalogue row — rejects adding a retired or soft-deleted medicine. */
  async findLiveMedicine(id: string) {
    return this.db.query.medicines.findFirst({
      columns: { id: true, name: true, isActive: true },
      where: and(eq(schema.medicines.id, id), isNull(schema.medicines.deletedAt)),
    });
  }

  /** Existing row for this pair, tombstones included, so add can revive one. */
  async findDoctorMedicinePair(doctorId: string, medicineId: string) {
    return this.db.query.doctorMedicines.findFirst({
      where: and(
        eq(schema.doctorMedicines.doctorId, doctorId),
        eq(schema.doctorMedicines.medicineId, medicineId),
      ),
    });
  }

  async findDoctorMedicine(id: string) {
    return this.db.query.doctorMedicines.findFirst({
      where: and(
        eq(schema.doctorMedicines.id, id),
        isNull(schema.doctorMedicines.deletedAt),
      ),
    });
  }

  /** Next free slot at the end of the list, so a new row lands last. */
  async nextDoctorMedicineSortOrder(doctorId: string) {
    const [row] = await this.db
      .select({
        next: sql<number>`COALESCE(MAX(${schema.doctorMedicines.sortOrder}), -1) + 1`,
      })
      .from(schema.doctorMedicines)
      .where(
        and(
          eq(schema.doctorMedicines.doctorId, doctorId),
          isNull(schema.doctorMedicines.deletedAt),
        ),
      );
    return Number(row?.next ?? 0);
  }

  async addDoctorMedicine(data: {
    doctorId: string;
    medicineId: string;
    defaultDosage?: string | null;
    defaultFrequency?: string | null;
    defaultDuration?: string | null;
    defaultQuantity?: number | null;
    notes?: string | null;
    sortOrder: number;
    createdBy?: string | null;
  }) {
    const [row] = await this.db
      .insert(schema.doctorMedicines)
      .values(data)
      .returning();
    return row!;
  }

  /**
   * Revives a previously removed row rather than inserting a duplicate. The
   * unique index is partial on deletedAt, so a plain insert would succeed and
   * leave two rows for the same pair once the tombstone is counted.
   */
  async reviveDoctorMedicine(
    id: string,
    data: {
      defaultDosage?: string | null;
      defaultFrequency?: string | null;
      defaultDuration?: string | null;
      defaultQuantity?: number | null;
      notes?: string | null;
      sortOrder: number;
      createdBy?: string | null;
    },
  ) {
    const [row] = await this.db
      .update(schema.doctorMedicines)
      .set({ ...data, isActive: true, deletedAt: null, updatedAt: new Date() })
      .where(eq(schema.doctorMedicines.id, id))
      .returning();
    return row!;
  }

  async updateDoctorMedicine(
    id: string,
    patch: Partial<{
      defaultDosage: string | null;
      defaultFrequency: string | null;
      defaultDuration: string | null;
      defaultQuantity: number | null;
      notes: string | null;
      sortOrder: number;
      isActive: boolean;
    }>,
  ) {
    const [row] = await this.db
      .update(schema.doctorMedicines)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(schema.doctorMedicines.id, id),
          isNull(schema.doctorMedicines.deletedAt),
        ),
      )
      .returning();
    return row ?? null;
  }

  async softDeleteDoctorMedicine(id: string) {
    const [row] = await this.db
      .update(schema.doctorMedicines)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.doctorMedicines.id, id),
          isNull(schema.doctorMedicines.deletedAt),
        ),
      )
      .returning({ id: schema.doctorMedicines.id });
    return row ?? null;
  }

  /**
   * Medicines this doctor has actually prescribed, most-prescribed first.
   *
   * Used to bootstrap an empty list — hand-curating one per doctor is work
   * nobody will do, and the prescription history already knows the answer.
   *
   * Routed through clinic_tokens rather than prescriptions: a prescription
   * records only a free-text `doctor_name`, so the sole trustworthy link from a
   * prescription back to a doctor *user* is the token that produced it
   * (clinic_tokens.doctor_id + clinic_tokens.prescription_id). Matching on the
   * name string instead would silently merge two doctors who share a surname.
   * The consequence is that only in-house consultations count — an outside
   * doctor's scanned prescription has no token and cannot be attributed.
   *
   * Free-text prescription lines (medicineId null, written before the medicine
   * reached the catalogue) are skipped because there is nothing to point at.
   */
  async findMostPrescribedMedicineIds(doctorId: string, limit: number) {
    const rows = await this.db
      .select({
        medicineId: schema.prescriptionItems.medicineId,
        timesPrescribed: sql<number>`COUNT(*)`,
        lastDosage: sql<string | null>`MAX(${schema.prescriptionItems.dosage})`,
        lastFrequency: sql<string | null>`MAX(${schema.prescriptionItems.frequency})`,
        lastDuration: sql<string | null>`MAX(${schema.prescriptionItems.duration})`,
      })
      .from(schema.prescriptionItems)
      .innerJoin(
        schema.clinicTokens,
        eq(
          schema.clinicTokens.prescriptionId,
          schema.prescriptionItems.prescriptionId,
        ),
      )
      .innerJoin(
        schema.prescriptions,
        eq(schema.prescriptionItems.prescriptionId, schema.prescriptions.id),
      )
      .innerJoin(
        schema.medicines,
        eq(schema.prescriptionItems.medicineId, schema.medicines.id),
      )
      .where(
        and(
          eq(schema.clinicTokens.doctorId, doctorId),
          isNotNull(schema.prescriptionItems.medicineId),
          isNull(schema.prescriptions.deletedAt),
          isNull(schema.medicines.deletedAt),
          eq(schema.medicines.isActive, true),
        ),
      )
      .groupBy(schema.prescriptionItems.medicineId)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(limit);
    return rows;
  }

  /** Pairs already on the list, so an import can skip them without N queries. */
  async findExistingDoctorMedicineIds(doctorId: string, medicineIds: string[]) {
    if (medicineIds.length === 0) return [];
    const rows = await this.db
      .select({ medicineId: schema.doctorMedicines.medicineId })
      .from(schema.doctorMedicines)
      .where(
        and(
          eq(schema.doctorMedicines.doctorId, doctorId),
          inArray(schema.doctorMedicines.medicineId, medicineIds),
          isNull(schema.doctorMedicines.deletedAt),
        ),
      );
    return rows.map((r) => r.medicineId);
  }

  async addDoctorMedicinesBulk(
    rows: {
      doctorId: string;
      medicineId: string;
      defaultDosage?: string | null;
      defaultFrequency?: string | null;
      defaultDuration?: string | null;
      sortOrder: number;
      createdBy?: string | null;
    }[],
  ) {
    if (rows.length === 0) return [];
    return this.db.insert(schema.doctorMedicines).values(rows).returning();
  }
}
