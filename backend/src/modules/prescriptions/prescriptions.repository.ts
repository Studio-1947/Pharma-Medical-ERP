import { Injectable } from "@nestjs/common";
import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
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
    if (params.status) {
      conditions.push(eq(schema.prescriptions.status, params.status as any));
    }

    const where = and(...conditions);

    const [items, [countRow]] = await Promise.all([
      this.db
        .select()
        .from(schema.prescriptions)
        .where(where)
        .orderBy(desc(schema.prescriptions.createdAt))
        .limit(params.limit)
        .offset((params.page - 1) * params.limit),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.prescriptions)
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

  async create(data: CreatePrescriptionDto) {
    return this.db.transaction(async (tx) => {
      const [prescription] = await tx
        .insert(schema.prescriptions)
        .values({
          patientId: data.patientId,
          doctorName: data.doctorName,
          doctorRegNo: data.doctorRegNo,
          hospitalName: data.hospitalName,
          issuedDate: data.issuedDate,
          expiryDate: data.expiryDate,
          notes: data.notes,
          isControlled: data.isControlled ?? false,
          fileUrl: data.fileUrl,
          status: "pending_verification",
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
