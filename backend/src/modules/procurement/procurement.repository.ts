import { Injectable } from "@nestjs/common";
import { and, desc, eq, ilike, isNull, or, sql, gte, lte } from "drizzle-orm";
import { DrizzleService } from "../../database/drizzle.service";
import * as schema from "../../database/schema";
import type {
  CreateSupplierDto,
  UpdateSupplierDto,
  QuerySupplierDto,
  CreatePurchaseOrderDto,
  QueryPurchaseOrderDto,
  CreateGrnDto,
} from "@pharmerp/types";

@Injectable()
export class ProcurementRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
  }

  // ─── Suppliers ───────────────────────────────────────────────────────────────

  async findAllSuppliers(params: QuerySupplierDto) {
    const conditions = [isNull(schema.suppliers.deletedAt)];

    if (params.search) {
      conditions.push(
        or(
          ilike(schema.suppliers.name, `%${params.search}%`),
          ilike(schema.suppliers.code, `%${params.search}%`),
          ilike(schema.suppliers.phone, `%${params.search}%`),
        ) as any,
      );
    }
    if (params.isActive !== undefined) {
      conditions.push(eq(schema.suppliers.isActive, params.isActive));
    }

    const where = and(...conditions);

    const [items, [countRow]] = await Promise.all([
      this.db
        .select()
        .from(schema.suppliers)
        .where(where)
        .orderBy(schema.suppliers.name)
        .limit(params.limit)
        .offset((params.page - 1) * params.limit),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.suppliers)
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

  async findSupplierById(id: string) {
    return this.db.query.suppliers.findFirst({
      where: and(eq(schema.suppliers.id, id), isNull(schema.suppliers.deletedAt)),
      with: { purchaseOrders: { limit: 5, orderBy: desc(schema.purchaseOrders.createdAt) } },
    });
  }

  async createSupplier(data: CreateSupplierDto) {
    const [supplier] = await this.db
      .insert(schema.suppliers)
      .values(data as any)
      .returning();
    return supplier!;
  }

  async updateSupplier(id: string, data: UpdateSupplierDto) {
    const [supplier] = await this.db
      .update(schema.suppliers)
      .set({ ...(data as any), updatedAt: new Date() })
      .where(eq(schema.suppliers.id, id))
      .returning();
    return supplier!;
  }

  async softDeleteSupplier(id: string) {
    await this.db
      .update(schema.suppliers)
      .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
      .where(eq(schema.suppliers.id, id));
  }

  // ─── Purchase Orders ──────────────────────────────────────────────────────────

  async findAllPOs(params: QueryPurchaseOrderDto) {
    const conditions = [isNull(schema.purchaseOrders.deletedAt)];

    if (params.supplierId) {
      conditions.push(eq(schema.purchaseOrders.supplierId, params.supplierId));
    }
    if (params.status) {
      conditions.push(eq(schema.purchaseOrders.status, params.status as any));
    }
    if (params.from) {
      conditions.push(gte(schema.purchaseOrders.createdAt, new Date(params.from)));
    }
    if (params.to) {
      conditions.push(lte(schema.purchaseOrders.createdAt, new Date(params.to)));
    }

    const where = and(...conditions);

    const [items, [countRow]] = await Promise.all([
      this.db.query.purchaseOrders.findMany({
        where,
        with: { supplier: { columns: { id: true, name: true, code: true } } },
        orderBy: [desc(schema.purchaseOrders.createdAt)],
        limit: params.limit,
        offset: (params.page - 1) * params.limit,
      }),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.purchaseOrders)
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

  async findPOById(id: string) {
    return this.db.query.purchaseOrders.findFirst({
      where: and(eq(schema.purchaseOrders.id, id), isNull(schema.purchaseOrders.deletedAt)),
      with: {
        supplier: true,
        warehouse: true,
        items: { with: { medicine: true } },
        grns: { with: { items: true } },
      },
    });
  }

  async createPO(data: CreatePurchaseOrderDto, raisedBy: string) {
    return this.db.transaction(async (tx) => {
      const poNumber = `PO-${Date.now()}`;

      let subtotal = 0;
      let taxAmount = 0;

      for (const item of data.items) {
        const qty = item.orderedQty;
        const cost = parseFloat(item.unitCost);
        const taxPct = parseFloat(item.taxPct ?? "0");
        const lineBase = qty * cost;
        const lineTax = lineBase * (taxPct / 100);
        subtotal += lineBase;
        taxAmount += lineTax;
      }

      const totalValue = subtotal + taxAmount;

      const [po] = await tx
        .insert(schema.purchaseOrders)
        .values({
          poNumber,
          supplierId: data.supplierId,
          warehouseId: data.warehouseId,
          raisedBy,
          status: "draft",
          expectedDelivery: data.expectedDelivery,
          notes: data.notes,
          subtotal: subtotal.toFixed(2),
          taxAmount: taxAmount.toFixed(2),
          totalValue: totalValue.toFixed(2),
        })
        .returning();

      await tx.insert(schema.purchaseOrderItems).values(
        data.items.map((item) => {
          const lineBase = item.orderedQty * parseFloat(item.unitCost);
          const lineTax = lineBase * (parseFloat(item.taxPct ?? "0") / 100);
          return {
            poId: po!.id,
            medicineId: item.medicineId,
            orderedQty: item.orderedQty,
            unitCost: item.unitCost,
            taxPct: item.taxPct ?? "0",
            lineTotal: (lineBase + lineTax).toFixed(2),
          };
        }),
      );

      return po!;
    });
  }

  async approvePO(id: string, approvedBy: string) {
    const [po] = await this.db
      .update(schema.purchaseOrders)
      .set({
        status: "approved",
        approvedBy,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.purchaseOrders.id, id))
      .returning();
    return po!;
  }

  async sendPO(id: string) {
    const [po] = await this.db
      .update(schema.purchaseOrders)
      .set({ status: "sent", updatedAt: new Date() })
      .where(eq(schema.purchaseOrders.id, id))
      .returning();
    return po!;
  }

  async cancelPO(id: string) {
    const [po] = await this.db
      .update(schema.purchaseOrders)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(schema.purchaseOrders.id, id))
      .returning();
    return po!;
  }

  // ─── GRN ─────────────────────────────────────────────────────────────────────

  async createGRN(dto: CreateGrnDto, receivedBy: string, tx?: any) {
    const db = tx ?? this.db;

    const grnNumber = `GRN-${Date.now()}`;

    // Get PO details to find warehouse and supplier
    const po = await db.query.purchaseOrders.findFirst({
      where: eq(schema.purchaseOrders.id, dto.poId),
      with: { items: true },
    });
    if (!po) throw new Error(`PO ${dto.poId} not found during GRN`);

    // Find a default storage location for this warehouse
    const [location] = await db
      .select({ id: schema.storageLocations.id })
      .from(schema.storageLocations)
      .where(eq(schema.storageLocations.warehouseId, po.warehouseId))
      .limit(1);

    if (!location) {
      throw new Error(`No storage locations found for warehouse ${po.warehouseId}. Create one first.`);
    }

    let grnTotal = 0;

    const createdBatchIds: string[] = [];

    // Create GRN record first
    const [grn] = await db
      .insert(schema.goodsReceivedNotes)
      .values({
        grnNumber,
        poId: dto.poId,
        receivedBy,
        supplierInvoiceNo: dto.supplierInvoiceNo,
        qcPassed: dto.qcPassed,
        qcNotes: dto.qcNotes,
      })
      .returning();

    for (const item of dto.items) {
      const poItem = po.items.find((i: any) => i.id === item.poItemId);
      if (!poItem) continue;

      const lineCost = parseFloat(poItem.unitCost) * item.receivedQty;
      const lineTax = lineCost * (parseFloat(poItem.taxPct) / 100);
      grnTotal += lineCost + lineTax;

      // Create inventory batch
      const [batch] = await db
        .insert(schema.inventoryBatches)
        .values({
          medicineId: poItem.medicineId,
          locationId: location.id,
          batchNo: item.batchNo,
          expiryDate: item.expiryDate,
          quantity: item.receivedQty,
          costPrice: poItem.unitCost,
          mrpAtEntry: poItem.unitCost, // MRP default to cost if not provided, can be updated later
          status: "active",
          poId: dto.poId,
          grnId: grn!.id,
        })
        .returning();

      createdBatchIds.push(batch!.id);

      // Create stock movement
      await db.insert(schema.stockMovements).values({
        batchId: batch!.id,
        medicineId: poItem.medicineId,
        movementType: "purchase",
        quantity: item.receivedQty,
        performedBy: receivedBy,
        referenceType: "grn",
        referenceId: grn!.id,
      });

      // Insert GRN item
      await db.insert(schema.grnItems).values({
        grnId: grn!.id,
        poItemId: item.poItemId,
        batchId: batch!.id,
        receivedQty: item.receivedQty,
        rejectedQty: item.rejectedQty ?? 0,
        batchNo: item.batchNo,
        expiryDate: item.expiryDate,
      });

      // Update PO item received qty
      await db
        .update(schema.purchaseOrderItems)
        .set({
          receivedQty: sql`${schema.purchaseOrderItems.receivedQty} + ${item.receivedQty}`,
        })
        .where(eq(schema.purchaseOrderItems.id, item.poItemId));
    }

    // Update supplier outstanding balance
    await db
      .update(schema.suppliers)
      .set({
        outstandingBalance: sql`${schema.suppliers.outstandingBalance} + ${grnTotal.toFixed(2)}`,
        updatedAt: new Date(),
      })
      .where(eq(schema.suppliers.id, po.supplierId));

    return { grn: grn!, batchIds: createdBatchIds };
  }

  async getPOItemsReceivingStatus(poId: string) {
    const items = await this.db
      .select({
        id: schema.purchaseOrderItems.id,
        orderedQty: schema.purchaseOrderItems.orderedQty,
        receivedQty: schema.purchaseOrderItems.receivedQty,
      })
      .from(schema.purchaseOrderItems)
      .where(eq(schema.purchaseOrderItems.poId, poId));
    return items;
  }

  async updatePOStatus(
    poId: string,
    status: "partially_received" | "received",
    tx?: any,
  ) {
    const db = tx ?? this.db;
    await db
      .update(schema.purchaseOrders)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.purchaseOrders.id, poId));
  }
}
