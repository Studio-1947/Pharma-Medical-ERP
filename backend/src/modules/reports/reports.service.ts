import { Injectable } from "@nestjs/common";
import { and, between, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { DrizzleService } from "../../database/drizzle.service";
import { ClickHouseService } from "../../common/clickhouse/clickhouse.service";
import * as schema from "../../database/schema";

@Injectable()
export class ReportsService {
  constructor(
    private readonly drizzle: DrizzleService,
    private readonly clickhouse: ClickHouseService,
  ) {}

  private get db() {
    return this.drizzle.db;
  }

  async getGstData(branchId: string, month: number, year: number) {
    const startDate = new Date(year, month - 1, 1).toISOString();
    const endDate = new Date(year, month, 0, 23, 59, 59).toISOString();

    const results = await this.db
      .select({
        invoiceNo: schema.salesInvoices.invoiceNo,
        date: schema.salesInvoices.createdAt,
        customerGstin: schema.salesInvoices.customerGstin,
        itemName: schema.medicines.name,
        hsnCode: schema.medicines.hsnCode,
        quantity: schema.salesInvoiceItems.quantity,
        unitPrice: schema.salesInvoiceItems.unitPrice,
        taxableAmount: sql<number>`CAST(${schema.salesInvoiceItems.lineTotal} AS FLOAT) - CAST(${schema.salesInvoiceItems.cgstAmt} AS FLOAT) - CAST(${schema.salesInvoiceItems.sgstAmt} AS FLOAT) - CAST(${schema.salesInvoiceItems.igstAmt} AS FLOAT)`,
        cgstAmount: schema.salesInvoiceItems.cgstAmt,
        sgstAmount: schema.salesInvoiceItems.sgstAmt,
        igstAmount: schema.salesInvoiceItems.igstAmt,
        totalAmount: schema.salesInvoiceItems.lineTotal,
      })
      .from(schema.salesInvoices)
      .innerJoin(
        schema.salesInvoiceItems,
        eq(schema.salesInvoices.id, schema.salesInvoiceItems.invoiceId),
      )
      .innerJoin(
        schema.medicines,
        eq(schema.salesInvoiceItems.medicineId, schema.medicines.id),
      )
      .where(
        and(
          eq(schema.salesInvoices.branchId, branchId),
          eq(schema.salesInvoices.status, "confirmed"),
          between(schema.salesInvoices.createdAt, new Date(startDate), new Date(endDate)),
        ),
      );

    return results.map(r => ({
      ...r,
      date: r.date.toISOString().split("T")[0],
    }));
  }

  async getSalesTrend(days: number, branchId?: string, groupBy: "day" | "week" | "month" = "day") {
    const since = new Date();
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);

    const conditions = [
      eq(schema.salesInvoices.status, "confirmed"),
      gte(schema.salesInvoices.createdAt, since),
    ];
    if (branchId) conditions.push(eq(schema.salesInvoices.branchId, branchId));

    const bucketExpr =
      groupBy === "month"
        ? sql<string>`TO_CHAR(${schema.salesInvoices.createdAt}, 'YYYY-MM')`
        : groupBy === "week"
          ? sql<string>`TO_CHAR(DATE_TRUNC('week', ${schema.salesInvoices.createdAt}), 'YYYY-MM-DD')`
          : sql<string>`DATE(${schema.salesInvoices.createdAt})`;

    const rows = await this.db
      .select({
        date: bucketExpr,
        revenue: sql<number>`COALESCE(SUM(CAST(${schema.salesInvoices.totalAmount} AS FLOAT)), 0)`,
        invoices: sql<number>`COUNT(${schema.salesInvoices.id})`,
      })
      .from(schema.salesInvoices)
      .where(and(...conditions))
      .groupBy(bucketExpr)
      .orderBy(bucketExpr);

    return { rows };
  }

  async getSummary(days: number, branchId?: string) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const conditions = [
      eq(schema.salesInvoices.status, "confirmed"),
      gte(schema.salesInvoices.createdAt, since),
    ];
    if (branchId) conditions.push(eq(schema.salesInvoices.branchId, branchId));

    const [row] = await this.db
      .select({
        totalRevenue: sql<number>`COALESCE(SUM(CAST(${schema.salesInvoices.totalAmount} AS FLOAT)), 0)`,
        totalInvoices: sql<number>`COUNT(${schema.salesInvoices.id})`,
      })
      .from(schema.salesInvoices)
      .where(and(...conditions));

    return {
      totalRevenue: Number(row?.totalRevenue ?? 0),
      totalInvoices: Number(row?.totalInvoices ?? 0),
    };
  }

  async getTopProducts(days: number, limit: number, branchId?: string) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const conditions = [
      eq(schema.salesInvoices.status, "confirmed"),
      gte(schema.salesInvoices.createdAt, since),
    ];
    if (branchId) conditions.push(eq(schema.salesInvoices.branchId, branchId));

    const rows = await this.db
      .select({
        name: schema.medicines.name,
        revenue: sql<number>`COALESCE(SUM(CAST(${schema.salesInvoiceItems.lineTotal} AS FLOAT)), 0)`,
        qty: sql<number>`COALESCE(SUM(${schema.salesInvoiceItems.quantity}), 0)`,
      })
      .from(schema.salesInvoiceItems)
      .innerJoin(schema.salesInvoices, eq(schema.salesInvoiceItems.invoiceId, schema.salesInvoices.id))
      .innerJoin(schema.medicines, eq(schema.salesInvoiceItems.medicineId, schema.medicines.id))
      .where(and(...conditions))
      .groupBy(schema.medicines.name)
      .orderBy(desc(sql`SUM(CAST(${schema.salesInvoiceItems.lineTotal} AS FLOAT))`))
      .limit(limit);

    return { rows };
  }

  async getPaymentMethodBreakdown(days: number, branchId?: string) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const conditions = [
      eq(schema.salesInvoices.status, "confirmed"),
      gte(schema.salesInvoices.createdAt, since),
    ];
    if (branchId) conditions.push(eq(schema.salesInvoices.branchId, branchId));

    const rows = await this.db
      .select({
        method: schema.payments.mode,
        amount: sql<number>`COALESCE(SUM(CAST(${schema.payments.amount} AS FLOAT)), 0)`,
      })
      .from(schema.payments)
      .innerJoin(schema.salesInvoices, eq(schema.payments.invoiceId, schema.salesInvoices.id))
      .where(and(...conditions))
      .groupBy(schema.payments.mode);

    return { rows };
  }

  async getPurchaseSummary(
    from: string,
    to: string,
    warehouseId?: string,
    branchId?: string,
  ) {
    const start = new Date(from);
    start.setHours(0, 0, 0, 0);
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);

    const conditions = [
      isNull(schema.purchaseOrders.deletedAt),
      between(schema.purchaseOrders.createdAt, start, end),
    ];
    if (warehouseId) conditions.push(eq(schema.purchaseOrders.warehouseId, warehouseId));
    // POs have no branch of their own — they belong to a branch via warehouse.
    if (branchId) {
      conditions.push(
        inArray(
          schema.purchaseOrders.warehouseId,
          this.db
            .select({ id: schema.warehouses.id })
            .from(schema.warehouses)
            .where(eq(schema.warehouses.branchId, branchId)),
        ),
      );
    }

    const [totals] = await this.db
      .select({
        totalOrders: sql<number>`COUNT(${schema.purchaseOrders.id})`,
        totalValue: sql<number>`COALESCE(SUM(CAST(${schema.purchaseOrders.totalValue} AS FLOAT)), 0)`,
        receivedOrders: sql<number>`COUNT(CASE WHEN ${schema.purchaseOrders.status} = 'received' THEN 1 END)`,
        pendingOrders: sql<number>`COUNT(CASE WHEN ${schema.purchaseOrders.status} IN ('draft','pending_approval','approved','sent') THEN 1 END)`,
      })
      .from(schema.purchaseOrders)
      .where(and(...conditions));

    const rows = await this.db
      .select({
        id: schema.purchaseOrders.id,
        poNumber: schema.purchaseOrders.poNumber,
        status: schema.purchaseOrders.status,
        supplierName: schema.suppliers.name,
        totalValue: schema.purchaseOrders.totalValue,
        createdAt: schema.purchaseOrders.createdAt,
        expectedDelivery: schema.purchaseOrders.expectedDelivery,
      })
      .from(schema.purchaseOrders)
      .innerJoin(schema.suppliers, eq(schema.purchaseOrders.supplierId, schema.suppliers.id))
      .where(and(...conditions))
      .orderBy(desc(schema.purchaseOrders.createdAt))
      .limit(50);

    return {
      summary: {
        totalOrders: Number(totals?.totalOrders ?? 0),
        totalValue: Number(totals?.totalValue ?? 0),
        receivedOrders: Number(totals?.receivedOrders ?? 0),
        pendingOrders: Number(totals?.pendingOrders ?? 0),
      },
      rows: rows.map(r => ({
        ...r,
        totalValue: Number(r.totalValue),
        createdAt: r.createdAt.toISOString().split("T")[0],
      })),
    };
  }

  async getScheduleHData(branchId: string, fromDate: string, toDate: string) {
    const start = new Date(fromDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(toDate);
    end.setHours(23, 59, 59, 999);

    const results = await this.db
      .select({
        date: schema.salesInvoices.createdAt,
        invoiceNo: schema.salesInvoices.invoiceNo,
        drugName: schema.medicines.name,
        scheduleClass: schema.medicines.scheduleClass,
        batchId: schema.salesInvoiceItems.batchId,
        quantity: schema.salesInvoiceItems.quantity,
        patientName: schema.patients.name,
        doctorName: schema.prescriptions.doctorName,
        doctorRegNo: schema.prescriptions.doctorRegNo,
      })
      .from(schema.salesInvoices)
      .innerJoin(
        schema.salesInvoiceItems,
        eq(schema.salesInvoices.id, schema.salesInvoiceItems.invoiceId),
      )
      .innerJoin(
        schema.medicines,
        eq(schema.salesInvoiceItems.medicineId, schema.medicines.id),
      )
      .leftJoin(
        schema.patients,
        eq(schema.salesInvoices.patientId, schema.patients.id),
      )
      .leftJoin(
        schema.prescriptions,
        eq(schema.salesInvoices.prescriptionId, schema.prescriptions.id),
      )
      .where(
        and(
          eq(schema.salesInvoices.branchId, branchId),
          eq(schema.salesInvoices.status, "confirmed"),
          between(schema.salesInvoices.createdAt, start, end),
          inArray(schema.medicines.scheduleClass, ["SCHEDULE_H", "SCHEDULE_H1", "SCHEDULE_X"]),
        ),
      );

    // Fetch batch numbers to enrich data
    const batchIds = [...new Set(results.map(r => r.batchId))];
    let batchMap: Record<string, string> = {};
    if (batchIds.length > 0) {
      const batches = await this.db
        .select({ id: schema.inventoryBatches.id, batchNo: schema.inventoryBatches.batchNo })
        .from(schema.inventoryBatches)
        .where(inArray(schema.inventoryBatches.id, batchIds));
      
      batchMap = batches.reduce((acc, curr) => {
        acc[curr.id] = curr.batchNo;
        return acc;
      }, {} as Record<string, string>);
    }

    return results.map(r => ({
      date: r.date.toISOString().split("T")[0],
      invoiceNo: r.invoiceNo,
      drugName: r.drugName,
      scheduleClass: r.scheduleClass,
      batchNo: batchMap[r.batchId!] || "N/A",
      quantity: r.quantity,
      patientName: r.patientName || "N/A",
      doctorName: r.doctorName || "N/A",
      doctorRegNo: r.doctorRegNo || "N/A",
    }));
  }

  getAbcAnalysis(branchId: string, days: number) {
    return this.clickhouse.getAbcAnalysis(branchId, days);
  }

  getHourlySalesPattern(branchId: string, days: number) {
    return this.clickhouse.getHourlySalesPattern(branchId, days);
  }
}
