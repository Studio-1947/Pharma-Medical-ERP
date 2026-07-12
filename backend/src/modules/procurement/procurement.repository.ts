import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, gte, lte } from "drizzle-orm";
import Decimal from "decimal.js";
import { DrizzleService } from "../../database/drizzle.service";
import * as schema from "../../database/schema";
import { calculateLine } from "./procurement.pricing";
import type {
  CreateSupplierDto,
  UpdateSupplierDto,
  QuerySupplierDto,
  CreatePurchaseOrderDto,
  QueryPurchaseOrderDto,
  CreateGrnDto,
  CreateSupplierReturnDto,
  ResolveReturnReplacementDto,
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

  /** Find a live supplier by its unique code (for duplicate detection). */
  async findSupplierByCode(code: string, excludeId?: string) {
    const conditions = [
      eq(schema.suppliers.code, code),
      isNull(schema.suppliers.deletedAt),
    ];
    if (excludeId) conditions.push(sql`${schema.suppliers.id} <> ${excludeId}`);
    const [supplier] = await this.db
      .select({ id: schema.suppliers.id, name: schema.suppliers.name, code: schema.suppliers.code })
      .from(schema.suppliers)
      .where(and(...conditions))
      .limit(1);
    return supplier ?? null;
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
        grns: {
          orderBy: (grns, { desc: descOp }) => [descOp(grns.receivedAt)],
          with: {
            user: {
              columns: { id: true, firstName: true, lastName: true },
            },
            items: {
              with: {
                poItem: { with: { medicine: true } },
                batch: true,
              },
            },
          },
        },
      },
    });
  }

  async createPO(data: CreatePurchaseOrderDto, raisedBy: string) {
    return this.db.transaction(async (tx) => {
      const poNumber = `PO-${Date.now()}`;

      let subtotal = new Decimal(0);
      let taxAmount = new Decimal(0);

      const lines = data.items.map((item) => {
        const { lineCost, lineTax, lineTotal } = calculateLine({
          unitCost: item.unitCost,
          taxPct: item.taxPct ?? "0",
          discountPct: item.discountPct ?? "0",
          qty: item.orderedQty,
        });
        subtotal = subtotal.plus(lineCost);
        taxAmount = taxAmount.plus(lineTax);
        return { item, lineTotal };
      });

      const totalValue = subtotal.plus(taxAmount);

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
        lines.map(({ item, lineTotal }) => ({
          poId: po!.id,
          medicineId: item.medicineId,
          orderedQty: item.orderedQty,
          unitCost: item.unitCost,
          taxPct: item.taxPct ?? "0",
          schemeFreeQty: item.schemeFreeQty ?? 0,
          discountPct: item.discountPct ?? "0",
          isConsignment: item.isConsignment ?? false,
          lineTotal: lineTotal.toFixed(2),
        })),
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

    let grnTotal = new Decimal(0);

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

      const freeQty = item.freeQty ?? 0;
      const billedQty = Math.max(0, item.receivedQty - freeQty);
      const { lineTotal } = calculateLine({
        unitCost: poItem.unitCost,
        taxPct: poItem.taxPct,
        discountPct: poItem.discountPct,
        qty: billedQty,
      });
      // Consignment items aren't owed on delivery — only once sold — so they
      // don't count toward the bill total that hits outstandingBalance.
      if (!poItem.isConsignment) grnTotal = grnTotal.plus(lineTotal);

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
          isConsignment: poItem.isConsignment ?? false,
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
        freeQty,
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

  // ─── Supplier bills & ledger ────────────────────────────────────────────────

  /** GRNs (bills) for every PO raised against this supplier, oldest first. */
  async getGRNsForSupplier(supplierId: string) {
    const poRows = await this.db
      .select({ id: schema.purchaseOrders.id })
      .from(schema.purchaseOrders)
      .where(eq(schema.purchaseOrders.supplierId, supplierId));
    const poIds = poRows.map((r) => r.id);
    if (poIds.length === 0) return [];

    return this.db.query.goodsReceivedNotes.findMany({
      where: inArray(schema.goodsReceivedNotes.poId, poIds),
      orderBy: [asc(schema.goodsReceivedNotes.receivedAt)],
      with: {
        items: { with: { poItem: { with: { medicine: true } } } },
      },
    });
  }

  /** Single GRN (bill) with its parent PO, scoped for supplier-ownership checks. */
  async getGRNById(grnId: string) {
    return this.db.query.goodsReceivedNotes.findFirst({
      where: eq(schema.goodsReceivedNotes.id, grnId),
      with: {
        items: { with: { poItem: { with: { medicine: true } } } },
        purchaseOrder: { columns: { id: true, poNumber: true, supplierId: true } },
      },
    });
  }

  async getPaymentsForSupplier(supplierId: string) {
    return this.db
      .select()
      .from(schema.supplierPayments)
      .where(eq(schema.supplierPayments.supplierId, supplierId))
      .orderBy(asc(schema.supplierPayments.paidAt));
  }

  /** Resolves the owning supplier of a GRN, for cross-supplier payment checks. */
  async getGRNSupplierId(grnId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ supplierId: schema.purchaseOrders.supplierId })
      .from(schema.goodsReceivedNotes)
      .innerJoin(
        schema.purchaseOrders,
        eq(schema.goodsReceivedNotes.poId, schema.purchaseOrders.id),
      )
      .where(eq(schema.goodsReceivedNotes.id, grnId))
      .limit(1);
    return row?.supplierId ?? null;
  }

  async createSupplierPayment(
    params: {
      supplierId: string;
      grnId?: string | null;
      amount: string;
      method?: string;
      referenceNo?: string;
      paidAt?: string;
      notes?: string;
      paidBy: string;
      type?: "payment" | "credit_note";
    },
    tx?: any,
    skipBalanceUpdate = false,
  ) {
    const db = tx ?? this.db;

    const [payment] = await db
      .insert(schema.supplierPayments)
      .values({
        supplierId: params.supplierId,
        grnId: params.grnId,
        amount: params.amount,
        method: params.method,
        type: params.type ?? "payment",
        referenceNo: params.referenceNo,
        paidAt: params.paidAt ? new Date(params.paidAt) : undefined,
        paidBy: params.paidBy,
        notes: params.notes,
      })
      .returning();

    if (!skipBalanceUpdate) {
      await db
        .update(schema.suppliers)
        .set({
          outstandingBalance: sql`${schema.suppliers.outstandingBalance} - ${params.amount}`,
          updatedAt: new Date(),
        })
        .where(eq(schema.suppliers.id, params.supplierId));
    }

    return payment!;
  }

  /** True only if every item on this GRN came from a consignment PO line. */
  async isGRNPureConsignment(grnId: string): Promise<boolean> {
    const rows = await this.db
      .select({ isConsignment: schema.purchaseOrderItems.isConsignment })
      .from(schema.grnItems)
      .innerJoin(
        schema.purchaseOrderItems,
        eq(schema.grnItems.poItemId, schema.purchaseOrderItems.id),
      )
      .where(eq(schema.grnItems.grnId, grnId));
    return rows.length > 0 && rows.every((r) => r.isConsignment);
  }

  /**
   * Net quantity sold per batch (gross sold minus customer returns), for
   * computing how much of a consignment bill is actually payable so far.
   * Modeled on billing.repository.ts's findReturnedQuantities pattern.
   */
  async getSoldQuantitiesForBatches(batchIds: string[]): Promise<Map<string, number>> {
    if (batchIds.length === 0) return new Map();

    const [soldRows, returnedRows] = await Promise.all([
      this.db
        .select({
          batchId: schema.salesInvoiceItems.batchId,
          qty: sql<number>`sum(${schema.salesInvoiceItems.quantity})::int`,
        })
        .from(schema.salesInvoiceItems)
        .innerJoin(
          schema.salesInvoices,
          eq(schema.salesInvoiceItems.invoiceId, schema.salesInvoices.id),
        )
        .where(
          and(
            inArray(schema.salesInvoiceItems.batchId, batchIds),
            eq(schema.salesInvoices.isReturn, false),
            sql`${schema.salesInvoices.status} NOT IN ('draft', 'cancelled')`,
          ),
        )
        .groupBy(schema.salesInvoiceItems.batchId),
      this.db
        .select({
          batchId: schema.salesInvoiceItems.batchId,
          qty: sql<number>`sum(${schema.salesInvoiceItems.quantity})::int`,
        })
        .from(schema.salesInvoiceItems)
        .innerJoin(
          schema.salesInvoices,
          eq(schema.salesInvoiceItems.invoiceId, schema.salesInvoices.id),
        )
        .where(
          and(
            inArray(schema.salesInvoiceItems.batchId, batchIds),
            eq(schema.salesInvoices.isReturn, true),
          ),
        )
        .groupBy(schema.salesInvoiceItems.batchId),
    ]);

    const net = new Map<string, number>();
    for (const row of soldRows) net.set(row.batchId, (net.get(row.batchId) ?? 0) + (row.qty ?? 0));
    for (const row of returnedRows) net.set(row.batchId, (net.get(row.batchId) ?? 0) - (row.qty ?? 0));
    return net;
  }

  // ─── Supplier returns (expiry/damage) ──────────────────────────────────────────

  /**
   * Decrements the returned quantity from its batch (same atomic guarded
   * idiom used for sale deduction in billing.service.ts), logs a stock
   * movement, and records the return. Returns null if the batch doesn't have
   * enough quantity available.
   */
  async recordSupplierReturn(dto: CreateSupplierReturnDto, recordedBy: string, tx?: any) {
    const db = tx ?? this.db;

    const [batch] = await db
      .select({ id: schema.inventoryBatches.id, medicineId: schema.inventoryBatches.medicineId })
      .from(schema.inventoryBatches)
      .where(eq(schema.inventoryBatches.id, dto.batchId))
      .limit(1);
    if (!batch) throw new Error(`Batch ${dto.batchId} not found`);

    const [updated] = await db
      .update(schema.inventoryBatches)
      .set({
        quantity: sql`${schema.inventoryBatches.quantity} - ${dto.quantity}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.inventoryBatches.id, dto.batchId),
          gte(schema.inventoryBatches.quantity, dto.quantity),
        ),
      )
      .returning({ id: schema.inventoryBatches.id });
    if (!updated) return null;

    await db.insert(schema.stockMovements).values({
      batchId: dto.batchId,
      medicineId: batch.medicineId,
      movementType: "expiry_write_off",
      quantity: -dto.quantity,
      performedBy: recordedBy,
      referenceType: "supplier_return",
      notes: dto.reason,
    });

    const [ret] = await db
      .insert(schema.supplierReturns)
      .values({
        batchId: dto.batchId,
        quantity: dto.quantity,
        reason: dto.reason,
        notes: dto.notes,
        recordedBy,
      })
      .returning();

    return ret!;
  }

  async getReturnById(id: string) {
    return this.db.query.supplierReturns.findFirst({
      where: eq(schema.supplierReturns.id, id),
    });
  }

  /** Resolves the supplier a batch was delivered by, via its GRN → PO chain. */
  async getSupplierIdForBatch(batchId: string): Promise<string | null> {
    const [batch] = await this.db
      .select({ grnId: schema.inventoryBatches.grnId })
      .from(schema.inventoryBatches)
      .where(eq(schema.inventoryBatches.id, batchId))
      .limit(1);
    if (!batch?.grnId) return null;

    const [row] = await this.db
      .select({ supplierId: schema.purchaseOrders.supplierId })
      .from(schema.goodsReceivedNotes)
      .innerJoin(
        schema.purchaseOrders,
        eq(schema.goodsReceivedNotes.poId, schema.purchaseOrders.id),
      )
      .where(eq(schema.goodsReceivedNotes.id, batch.grnId))
      .limit(1);
    return row?.supplierId ?? null;
  }

  async resolveReturnAsReplacement(
    returnId: string,
    dto: ResolveReturnReplacementDto,
    resolvedBy: string,
    tx?: any,
  ) {
    const db = tx ?? this.db;

    const ret = await db.query.supplierReturns.findFirst({
      where: eq(schema.supplierReturns.id, returnId),
    });
    if (!ret) throw new Error(`Return ${returnId} not found`);

    const [originalBatch] = await db
      .select()
      .from(schema.inventoryBatches)
      .where(eq(schema.inventoryBatches.id, ret.batchId))
      .limit(1);
    if (!originalBatch) throw new Error(`Batch ${ret.batchId} not found`);

    const [replacement] = await db
      .insert(schema.inventoryBatches)
      .values({
        medicineId: originalBatch.medicineId,
        locationId: originalBatch.locationId,
        batchNo: dto.batchNo,
        expiryDate: dto.expiryDate,
        quantity: ret.quantity,
        costPrice: "0",
        mrpAtEntry: originalBatch.mrpAtEntry,
        status: "active",
      })
      .returning();

    await db.insert(schema.stockMovements).values({
      batchId: replacement!.id,
      medicineId: originalBatch.medicineId,
      movementType: "purchase",
      quantity: ret.quantity,
      performedBy: resolvedBy,
      referenceType: "supplier_return_replacement",
      referenceId: ret.id,
    });

    const [updated] = await db
      .update(schema.supplierReturns)
      .set({
        outcome: "replacement",
        replacementBatchId: replacement!.id,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.supplierReturns.id, returnId))
      .returning();

    return updated!;
  }

  async resolveReturnAsCreditNote(
    returnId: string,
    amount: string,
    supplierPaymentId: string,
    tx?: any,
  ) {
    const db = tx ?? this.db;
    const [updated] = await db
      .update(schema.supplierReturns)
      .set({
        outcome: "credit_note",
        creditNoteAmount: amount,
        supplierPaymentId,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.supplierReturns.id, returnId))
      .returning();
    return updated!;
  }

  /** Returns for every batch that was ever delivered by this supplier. */
  async listReturnsForSupplier(supplierId: string) {
    const poRows = await this.db
      .select({ id: schema.purchaseOrders.id })
      .from(schema.purchaseOrders)
      .where(eq(schema.purchaseOrders.supplierId, supplierId));
    const poIds = poRows.map((r) => r.id);
    if (poIds.length === 0) return [];

    const grnRows = await this.db
      .select({ id: schema.goodsReceivedNotes.id })
      .from(schema.goodsReceivedNotes)
      .where(inArray(schema.goodsReceivedNotes.poId, poIds));
    const grnIds = grnRows.map((r) => r.id);
    if (grnIds.length === 0) return [];

    const batchRows = await this.db
      .select({ id: schema.inventoryBatches.id })
      .from(schema.inventoryBatches)
      .where(inArray(schema.inventoryBatches.grnId, grnIds));
    const batchIds = batchRows.map((r) => r.id);
    if (batchIds.length === 0) return [];

    return this.db.query.supplierReturns.findMany({
      where: inArray(schema.supplierReturns.batchId, batchIds),
      orderBy: [desc(schema.supplierReturns.createdAt)],
      with: { batch: { with: { medicine: true } } },
    });
  }
}
