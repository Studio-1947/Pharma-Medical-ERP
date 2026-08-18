import { Injectable } from "@nestjs/common";
import { and, desc, eq, getTableColumns, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { DrizzleService } from "../../database/drizzle.service";
import * as schema from "../../database/schema";
import type { CreatePrescriptionDto, UpdatePrescriptionDto, QueryPrescriptionDto, VerifyPrescriptionDto } from "@pharmerp/types";

@Injectable()
export class PrescriptionsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
  }

  async findPaginated(params: QueryPrescriptionDto) {
    const conditions = [isNull(schema.prescriptions.deletedAt)];

    if (params.patientId) {
      conditions.push(eq(schema.prescriptions.patientId, params.patientId));
    }
    if (params.branchId) {
      conditions.push(eq(schema.prescriptions.branchId, params.branchId));
    }
    if (params.status) {
      conditions.push(eq(schema.prescriptions.status, params.status as any));
    }

    if (params.search) {
      const searchOr = or(
        ilike(schema.prescriptions.doctorName, `%${params.search}%`),
        ilike(schema.patients.name, `%${params.search}%`),
        ilike(schema.prescriptions.notes, `%${params.search}%`),
      );
      if (searchOr) conditions.push(searchOr);
    }

    const where = and(...conditions);

    const [items, [countRow]] = await Promise.all([
      this.db
        .select({
          ...getTableColumns(schema.prescriptions),
          patient: {
            id: schema.patients.id,
            name: schema.patients.name,
            phone: schema.patients.phone,
          },
        })
        .from(schema.prescriptions)
        .leftJoin(
          schema.patients,
          eq(schema.prescriptions.patientId, schema.patients.id),
        )
        .where(where)
        .orderBy(desc(schema.prescriptions.createdAt))
        .limit(params.limit)
        .offset((params.page - 1) * params.limit),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.prescriptions)
        .where(where),
    ]);

    const prescriptionIds = items.map((i) => i.id);
    const itemsMap: Record<string, any[]> = {};
    if (prescriptionIds.length > 0) {
      const rxItems = await this.db.query.prescriptionItems.findMany({
        where: inArray(schema.prescriptionItems.prescriptionId, prescriptionIds),
        with: { medicine: true },
      });
      rxItems.forEach((it) => {
        if (it.prescriptionId) {
          if (!itemsMap[it.prescriptionId]) itemsMap[it.prescriptionId] = [];
          itemsMap[it.prescriptionId]!.push(it);
        }
      });
    }

    const dataWithItems = items.map((i) => ({
      ...i,
      items: itemsMap[i.id] ?? [],
    }));

    return {
      data: dataWithItems,
      meta: {
        page: params.page,
        limit: params.limit,
        total: countRow?.count ?? 0,
        totalPages: Math.ceil((countRow?.count ?? 0) / params.limit),
      },
    };
  }

  async findById(id: string) {
    return this.db.query.prescriptions.findFirst({
      where: and(eq(schema.prescriptions.id, id), isNull(schema.prescriptions.deletedAt)),
      with: {
        patient: true,
        verifiedBy: true,
        items: {
          with: { medicine: true },
        },
      },
    });
  }

  /**
   * Clinic queue token this prescription was written under, or null.
   *
   * The link points from the token to the prescription, so this is a reverse
   * lookup. A prescription created outside the clinic queue (uploaded scan,
   * counter entry) legitimately has no token.
   */
  async findTokenNo(prescriptionId: string): Promise<number | null> {
    const row = await this.db.query.clinicTokens.findFirst({
      where: eq(schema.clinicTokens.prescriptionId, prescriptionId),
      columns: { tokenNo: true },
    });
    return row?.tokenNo ?? null;
  }

  /** Name of the signed-in prescriber, for attributing a prescription to them. */
  async findUserDisplayName(id: string) {
    const user = await this.db.query.users.findFirst({
      columns: { firstName: true, lastName: true, email: true },
      where: eq(schema.users.id, id),
    });
    if (!user) return null;
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
    if (name) return name.startsWith("Dr.") ? name : `Dr. ${name}`;
    if (user.email) {
      const rawName = (user.email.split("@")[0] ?? "doctor").replace(/[^a-zA-Z0-9]/g, " ").trim();
      const cap = rawName ? rawName.charAt(0).toUpperCase() + rawName.slice(1) : "Doctor";
      return `Dr. ${cap}`;
    }
    return "Dr. Doctor";
  }

  async create(
    data: CreatePrescriptionDto,
    opts?: { autoVerify?: boolean; verifiedBy?: string },
  ) {
    return this.db.transaction(async (tx) => {
      const [prescription] = await tx
        .insert(schema.prescriptions)
        .values({
          patientId: data.patientId,
          branchId: data.branchId,
          doctorName: data.doctorName,
          doctorRegNo: data.doctorRegNo,
          hospitalName: data.hospitalName,
          issuedDate: data.issuedDate,
          expiryDate: data.expiryDate,
          notes: data.notes,
          isControlled: data.isControlled ?? false,
          fileUrl: data.fileUrl,
          status: opts?.autoVerify ? "verified" : "pending_verification",
          verifiedBy: opts?.autoVerify ? opts.verifiedBy : undefined,
          verifiedAt: opts?.autoVerify ? new Date() : undefined,
        })
        .returning();

      if (data.items && data.items.length > 0) {
        await tx.insert(schema.prescriptionItems).values(
          data.items.map((item) => ({
            prescriptionId: prescription!.id,
            medicineId: item.medicineId,
            medicineName: item.medicineName,
            dosage: item.dosage,
            frequency: item.frequency,
            duration: item.duration,
            quantityPrescribed: item.quantityPrescribed,
          })),
        );
      }

      return prescription!;
    });
  }

  async verify(id: string, dto: VerifyPrescriptionDto, userId: string) {
    return this.db.transaction(async (tx) => {
      const newStatus =
        dto.action === "verify" ? "verified" : "rejected";

      const [updated] = await tx
        .update(schema.prescriptions)
        .set({
          status: newStatus as any,
          verifiedBy: userId,
          verifiedAt: new Date(),
          rejectionReason: dto.action === "reject" ? dto.rejectionReason : null,
          updatedAt: new Date(),
        })
        .where(eq(schema.prescriptions.id, id))
        .returning();

      if (dto.action === "verify" && dto.items && dto.items.length > 0) {
        for (const item of dto.items) {
          await tx
            .update(schema.prescriptionItems)
            .set({
              medicineId: item.medicineId,
              medicineName: item.medicineName,
              dosage: item.dosage,
              frequency: item.frequency,
              duration: item.duration,
              quantityPrescribed: item.quantityPrescribed,
            })
            .where(eq(schema.prescriptionItems.id, item.id));
        }
      }

      return updated!;
    });
  }

  async update(id: string, data: UpdatePrescriptionDto) {
    const [updated] = await this.db
      .update(schema.prescriptions)
      .set({ ...(data as any), updatedAt: new Date() })
      .where(eq(schema.prescriptions.id, id))
      .returning();
    return updated!;
  }

  async softDelete(id: string) {
    await this.db
      .update(schema.prescriptions)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.prescriptions.id, id));
  }
}
