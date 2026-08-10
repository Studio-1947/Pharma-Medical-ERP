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
          inArray(schema.salesInvoices.status, ["confirmed", "paid"]),
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
      inArray(schema.salesInvoices.status, ["confirmed", "paid"]),
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
      inArray(schema.salesInvoices.status, ["confirmed", "paid"]),
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

  /**
   * One row per branch plus a consolidated total, for the branch comparison
   * screen.
   *
   * Sales, stock and alerts are three separate aggregates joined in memory
   * rather than one query: a single statement joining invoices to batches
   * multiplies rows (every invoice against every batch of the same branch) and
   * silently inflates both totals.
   */
  async getBranchComparison(from: string, to: string) {
    const start = new Date(from);
    start.setHours(0, 0, 0, 0);
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);

    const today = new Date().toISOString().slice(0, 10);
    const in30Days = new Date();
    in30Days.setDate(in30Days.getDate() + 30);
    const expiryCutoff = in30Days.toISOString().slice(0, 10);

    const [branches, salesRows, stockRows, expiringRows] = await Promise.all([
      this.db
        .select({
          id: schema.branches.id,
          name: schema.branches.name,
          code: schema.branches.code,
          isActive: schema.branches.isActive,
        })
        .from(schema.branches)
        .orderBy(schema.branches.name),

      this.db
        .select({
          branchId: schema.salesInvoices.branchId,
          revenue: sql<number>`COALESCE(SUM(CAST(${schema.salesInvoices.totalAmount} AS FLOAT)), 0)`,
          invoices: sql<number>`COUNT(${schema.salesInvoices.id})`,
        })
        .from(schema.salesInvoices)
        .where(
          and(
            inArray(schema.salesInvoices.status, ["confirmed", "paid"]),
            between(schema.salesInvoices.createdAt, start, end),
          ),
        )
        .groupBy(schema.salesInvoices.branchId),

      this.db
        .select({
          branchId: schema.inventoryBatches.branchId,
          units: sql<number>`COALESCE(SUM(${schema.inventoryBatches.quantity}), 0)`,
          stockValue: sql<number>`COALESCE(SUM(${schema.inventoryBatches.quantity} * CAST(${schema.inventoryBatches.costPrice} AS FLOAT)), 0)`,
          batches: sql<number>`COUNT(${schema.inventoryBatches.id})`,
        })
        .from(schema.inventoryBatches)
        .where(eq(schema.inventoryBatches.status, "active"))
        .groupBy(schema.inventoryBatches.branchId),

      this.db
        .select({
          branchId: schema.inventoryBatches.branchId,
          expiringSoon: sql<number>`COUNT(${schema.inventoryBatches.id})`,
        })
        .from(schema.inventoryBatches)
        .where(
          and(
            eq(schema.inventoryBatches.status, "active"),
            sql`${schema.inventoryBatches.quantity} > 0`,
            sql`${schema.inventoryBatches.expiryDate} <= ${expiryCutoff}`,
            sql`${schema.inventoryBatches.expiryDate} >= ${today}`,
          ),
        )
        .groupBy(schema.inventoryBatches.branchId),
    ]);

    const salesBy = new Map(salesRows.map((r) => [r.branchId, r]));
    const stockBy = new Map(stockRows.map((r) => [r.branchId, r]));
    const expiringBy = new Map(expiringRows.map((r) => [r.branchId, r]));

    const rows = branches.map((b) => {
      const sales = salesBy.get(b.id);
      const stock = stockBy.get(b.id);
      const revenue = Number(sales?.revenue ?? 0);
      const invoices = Number(sales?.invoices ?? 0);
      return {
        branchId: b.id,
        branchName: b.name,
        branchCode: b.code,
        isActive: b.isActive,
        revenue,
        invoices,
        // Guarded: a branch with no sales in the window would divide by zero.
        avgInvoiceValue: invoices > 0 ? revenue / invoices : 0,
        units: Number(stock?.units ?? 0),
        stockValue: Number(stock?.stockValue ?? 0),
        batches: Number(stock?.batches ?? 0),
        expiringSoon: Number(expiringBy.get(b.id)?.expiringSoon ?? 0),
      };
    });

    const sum = (key: keyof (typeof rows)[number]) =>
      rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);

    const totalRevenue = sum("revenue");
    const totalInvoices = sum("invoices");

    return {
      from,
      to,
      rows,
      totals: {
        revenue: totalRevenue,
        invoices: totalInvoices,
        avgInvoiceValue: totalInvoices > 0 ? totalRevenue / totalInvoices : 0,
        units: sum("units"),
        stockValue: sum("stockValue"),
        batches: sum("batches"),
        expiringSoon: sum("expiringSoon"),
      },
    };
  }

  async getTopProducts(days: number, limit: number, branchId?: string) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const conditions = [
      inArray(schema.salesInvoices.status, ["confirmed", "paid"]),
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
      inArray(schema.salesInvoices.status, ["confirmed", "paid"]),
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

  async getPurchaseSummary(from: string, to: string, branchId?: string) {
    const start = new Date(from);
    start.setHours(0, 0, 0, 0);
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);

    const conditions = [
      isNull(schema.purchaseOrders.deletedAt),
      between(schema.purchaseOrders.createdAt, start, end),
    ];
    // POs now carry their own branch, so this is a direct filter rather than a
    // subquery over the warehouses that used to stand in for one.
    if (branchId) {
      conditions.push(eq(schema.purchaseOrders.branchId, branchId));
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
          inArray(schema.salesInvoices.status, ["confirmed", "paid"]),
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
