import { Injectable } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import { DrizzleService } from "../../database/drizzle.service";
import * as schema from "../../database/schema";

export interface CreateTransferDto {
  fromWarehouseId: string;
  toWarehouseId: string;
  notes?: string;
  items: {
    medicineId: string;
    batchId: string;
    requestedQty: number;
    notes?: string;
  }[];
}

export interface UpdateTransferStatusDto {
  status: "in_transit" | "delivered" | "rejected";
  podFileUrl?: string;
}

@Injectable()
export class DistributionRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
  }

  async findAll(params: { page: number; limit: number; status?: string }) {
    const conditions: any[] = [];
    if (params.status) {
      conditions.push(eq(schema.stockTransfers.status, params.status as any));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, [countRow]] = await Promise.all([
      this.db
        .select()
        .from(schema.stockTransfers)
        .where(where)
        .orderBy(desc(schema.stockTransfers.createdAt))
        .limit(params.limit)
        .offset((params.page - 1) * params.limit),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.stockTransfers)
        .where(where),
    ]);

    return {
      data: items,
      meta: { page: params.page, limit: params.limit, total: countRow?.count ?? 0 },
    };
  }

  async findById(id: string) {
    const [transfer] = await this.db
      .select()
      .from(schema.stockTransfers)
      .where(eq(schema.stockTransfers.id, id));

    if (!transfer) return null;

    const items = await this.db
      .select()
      .from(schema.stockTransferItems)
      .where(eq(schema.stockTransferItems.transferId, id));

    return { ...transfer!, items };
  }

  async create(data: CreateTransferDto, initiatedBy: string) {
    const transferNo = `TRF-${Date.now()}`;

    return this.db.transaction(async (tx) => {
      const [transfer] = await tx
        .insert(schema.stockTransfers)
        .values({
          transferNo,
          fromWarehouseId: data.fromWarehouseId,
          toWarehouseId: data.toWarehouseId,
          initiatedBy,
          notes: data.notes,
          status: "draft",
        })
        .returning();

      if (data.items.length > 0) {
        await tx.insert(schema.stockTransferItems).values(
          data.items.map((item) => ({
            transferId: transfer!.id,
            medicineId: item.medicineId,
            batchId: item.batchId,
            requestedQty: item.requestedQty,
            notes: item.notes,
          })),
        );
      }

      return transfer;
    });
  }

  async approve(id: string, approvedBy: string) {
    const [updated] = await this.db
      .update(schema.stockTransfers)
      .set({ status: "in_transit", approvedBy, dispatchedAt: new Date() })
      .where(
        and(
          eq(schema.stockTransfers.id, id),
          eq(schema.stockTransfers.status, "draft"),
        ),
      )
      .returning();
    return updated ?? null;
  }

  async deliver(
    id: string,
    dto: UpdateTransferStatusDto,
    receivedItems: { itemId: string; receivedQty: number; rejectedQty?: number }[],
  ) {
    return this.db.transaction(async (tx) => {
      for (const ri of receivedItems) {
        await tx
          .update(schema.stockTransferItems)
          .set({
            receivedQty: ri.receivedQty,
            rejectedQty: ri.rejectedQty ?? 0,
            sentQty: ri.receivedQty + (ri.rejectedQty ?? 0),
          })
          .where(eq(schema.stockTransferItems.id, ri.itemId));
      }

      const [updated] = await tx
        .update(schema.stockTransfers)
        .set({
          status: dto.status,
          podFileUrl: dto.podFileUrl,
          deliveredAt: new Date(),
        })
        .where(eq(schema.stockTransfers.id, id))
        .returning();

      return updated;
    });
  }

  async cancel(id: string) {
    const [updated] = await this.db
      .update(schema.stockTransfers)
      .set({ status: "rejected" })
      .where(
        and(
          eq(schema.stockTransfers.id, id),
          eq(schema.stockTransfers.status, "draft"),
        ),
      )
      .returning();
    return updated ?? null;
  }
}
