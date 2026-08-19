import { Injectable } from "@nestjs/common";
import { and, between, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { DrizzleService } from "../../database/drizzle.service";
import { ClickHouseService } from "../../common/clickhouse/clickhouse.service";
import * as schema from "../../database/schema";
import { suppliedInvoiceStatuses } from "../../common/utils/invoice-status";

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
          inArray(schema.salesInvoices.status, suppliedInvoiceStatuses()),
          between(schema.salesInvoices.createdAt, new Date(startDate), new Date(endDate)),
        ),
      );

    return results.map(r => ({
      ...r,
      date: r.date.toISOString().split("T")[0],
    }));
  }

  async getGstr1GovernmentJson(branchId: string, month: number, year: number) {
    const [branch] = await this.db
      .select({ gstin: schema.branches.gstin, name: schema.branches.name, state: schema.branches.state })
      .from(schema.branches)
      .where(eq(schema.branches.id, branchId));

    const gstin = branch?.gstin ?? "27AAAAA0000A1Z5";
    const fp = `${String(month).padStart(2, "0")}${year}`;

    const rawGstData = await this.getGstData(branchId, month, year);

    // Group B2B by Customer GSTIN
    const b2bMap = new Map<string, any[]>();
    const b2csMap = new Map<string, { txval: number; iamt: number; camt: number; samt: number }>();
    const hsnMap = new Map<string, { desc: string; qty: number; val: number; txval: number; iamt: number; camt: number; samt: number }>();

    for (const item of rawGstData) {
      // HSN summary grouping
      const hsnCode = item.hsnCode || "3004";
      if (!hsnMap.has(hsnCode)) {
        hsnMap.set(hsnCode, { desc: item.itemName, qty: 0, val: 0, txval: 0, iamt: 0, camt: 0, samt: 0 });
      }
      const hsnEntry = hsnMap.get(hsnCode)!;
      hsnEntry.qty += Number(item.quantity);
      hsnEntry.val += Number(item.totalAmount);
      hsnEntry.txval += Number(item.taxableAmount);
      hsnEntry.iamt += Number(item.igstAmount || 0);
      hsnEntry.camt += Number(item.cgstAmount || 0);
      hsnEntry.samt += Number(item.sgstAmount || 0);

      // B2B vs B2CS
      if (item.customerGstin && item.customerGstin.trim().length === 15) {
        const cGstin = item.customerGstin.trim();
        if (!b2bMap.has(cGstin)) b2bMap.set(cGstin, []);
        b2bMap.get(cGstin)!.push(item);
      } else {
        const key = "INTRA";
        if (!b2csMap.has(key)) {
          b2csMap.set(key, { txval: 0, iamt: 0, camt: 0, samt: 0 });
        }
        const b2csEntry = b2csMap.get(key)!;
        b2csEntry.txval += Number(item.taxableAmount);
        b2csEntry.iamt += Number(item.igstAmount || 0);
        b2csEntry.camt += Number(item.cgstAmount || 0);
        b2csEntry.samt += Number(item.sgstAmount || 0);
      }
    }

    // Build B2B array according to Govt Schema
    const b2b = Array.from(b2bMap.entries()).map(([ctin, invs]) => {
      const invGrouped = new Map<string, any[]>();
      for (const inv of invs) {
        if (!invGrouped.has(inv.invoiceNo)) invGrouped.set(inv.invoiceNo, []);
        invGrouped.get(inv.invoiceNo)!.push(inv);
      }

      const invList = Array.from(invGrouped.entries()).map(([inum, items]) => {
        const first = items[0];
        const val = items.reduce((acc, i) => acc + Number(i.totalAmount), 0);
        const itms = items.map((itm, num) => ({
          num: num + 1,
          itm_det: {
            txval: Number(Number(itm.taxableAmount).toFixed(2)),
            rt: Number((((Number(itm.cgstAmount) + Number(itm.sgstAmount) + Number(itm.igstAmount)) / (Number(itm.taxableAmount) || 1)) * 100).toFixed(2)),
            iamt: Number(Number(itm.igstAmount || 0).toFixed(2)),
            camt: Number(Number(itm.cgstAmount || 0).toFixed(2)),
            samt: Number(Number(itm.sgstAmount || 0).toFixed(2)),
          },
        }));

        return {
          inum,
          idt: first.date,
          val: Number(val.toFixed(2)),
          pos: ctin.slice(0, 2),
          rchrg: "N",
          inv_typ: "R",
          itms,
        };
      });

      return { ctin, inv: invList };
    });

    // Build B2CS array
    const b2cs = Array.from(b2csMap.entries()).map(([_, val]) => ({
      sply_ty: "INTRA",
      txval: Number(val.txval.toFixed(2)),
      pos: gstin.slice(0, 2),
      rt: 12.0,
      iamt: Number(val.iamt.toFixed(2)),
      camt: Number(val.camt.toFixed(2)),
      samt: Number(val.samt.toFixed(2)),
    }));

    // Build HSN array
    const hsnData = Array.from(hsnMap.entries()).map(([hsn_sc, val], idx) => ({
      num: idx + 1,
      hsn_sc,
      desc: val.desc,
      uqc: "BOX",
      qty: val.qty,
      val: Number(val.val.toFixed(2)),
      txval: Number(val.txval.toFixed(2)),
      iamt: Number(val.iamt.toFixed(2)),
      camt: Number(val.camt.toFixed(2)),
      samt: Number(val.samt.toFixed(2)),
    }));

    return {
      gstin,
      fp,
      version: "GST1.5",
      hash: "hash-placeholder",
      b2b,
      b2cs,
      hsn: { data: hsnData },
    };
  }

  async getSalesTrend(days: number, branchId?: string, groupBy: "day" | "week" | "month" = "day") {
    const since = new Date();
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);

    const conditions = [
      inArray(schema.salesInvoices.status, suppliedInvoiceStatuses()),
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
      inArray(schema.salesInvoices.status, suppliedInvoiceStatuses()),
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
            inArray(schema.salesInvoices.status, suppliedInvoiceStatuses()),
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
      inArray(schema.salesInvoices.status, suppliedInvoiceStatuses()),
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
      inArray(schema.salesInvoices.status, suppliedInvoiceStatuses()),
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
        rxPending: schema.salesInvoices.rxPending,
        attestedBy: schema.salesInvoices.overriddenBy,
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
          inArray(schema.salesInvoices.status, suppliedInvoiceStatuses()),
          between(schema.salesInvoices.createdAt, start, end),
          // Both spellings, deliberately. The seed writes "SCHEDULE_H"; the
          // imported catalogue writes "H" — and every controlled medicine on
          // the live database uses the short form, so filtering on the seed's
          // spelling alone returned an EMPTY register for a branch that had
          // genuinely dispensed Schedule H1. A statutory register that
          // silently reports nothing is worse than one that errors.
          sql`upper(regexp_replace(trim(${schema.medicines.scheduleClass}), '^SCHEDULE[_ -]?', '', 'i')) IN ('H', 'H1', 'X')`,
        ),
      );

    // Fetch batch numbers to enrich data. Fee lines carry no batch; the
    // innerJoin on medicines already excludes them, this just keeps the type
    // honest.
    const batchIds = [...new Set(results.map(r => r.batchId).filter((id): id is string => !!id))];
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
      // A sale a manager attested for has no prescription attached yet, so
      // these columns are genuinely unknown rather than not applicable. Saying
      // so is the point: "N/A" reads as "nothing to record" and would let an
      // incomplete register pass for a complete one at inspection.
      doctorName: r.doctorName || (r.rxPending ? "PRESCRIPTION PENDING" : "N/A"),
      doctorRegNo: r.doctorRegNo || (r.rxPending ? "PRESCRIPTION PENDING" : "N/A"),
      rxPending: !!r.rxPending,
    }));
  }

  getAbcAnalysis(branchId: string, days: number) {
    return this.clickhouse.getAbcAnalysis(branchId, days);
  }

  getHourlySalesPattern(branchId: string, days: number) {
    return this.clickhouse.getHourlySalesPattern(branchId, days);
  }
}
