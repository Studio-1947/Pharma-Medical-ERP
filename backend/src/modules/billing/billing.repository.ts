import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import Redis from "ioredis";
import { DrizzleService } from "../../database/drizzle.service";
import * as schema from "../../database/schema";
import { REDIS_CLIENT } from "../../common/redis/redis.module";
import type { QueryInvoiceDto } from "@pharmerp/types";

@Injectable()
export class BillingRepository {
  constructor(
    private readonly drizzle: DrizzleService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}
  private get db() {
    return this.drizzle.db;
  }

  async nextInvoiceNumber(branchId?: string, branchCode?: string): Promise<string> {
    const today = new Date().toISOString().split("T")[0]!; // YYYY-MM-DD
    let prefix = branchCode;
    if (!prefix && branchId) {
      const [b] = await this.db
        .select({ code: schema.branches.code })
        .from(schema.branches)
        .where(eq(schema.branches.id, branchId))
        .limit(1);
      prefix = b?.code;
    }
    const codePrefix = (prefix || "BRN01").toUpperCase();
    const key = branchId ? `invoice_seq:${branchId}:${today}` : `invoice_seq:${today}`;
    const seq = await this.redis.incr(key);
    if (seq === 1) {
      await this.redis.expire(key, 86400 * 2);
    }
    return `${codePrefix}-${today.replace(/-/g, "")}-${String(seq).padStart(5, "0")}`;
  }

  async createInvoiceWithItems(
    invoiceData: typeof schema.salesInvoices.$inferInsert,
    items: Omit<typeof schema.salesInvoiceItems.$inferInsert, "invoiceId">[],
    tx: any,
  ) {
    const [invoice] = await tx.insert(schema.salesInvoices).values(invoiceData).returning();
    const insertedItems = await tx
      .insert(schema.salesInvoiceItems)
      .values(items.map((i) => ({ ...i, invoiceId: invoice.id })))
      .returning();
    return { invoice, items: insertedItems };
  }

  async findPaginated(params: QueryInvoiceDto) {
    const conditions: any[] = [];
    if (params.patientId) conditions.push(eq(schema.salesInvoices.patientId, params.patientId));
    if (params.staffId) conditions.push(eq(schema.salesInvoices.staffId, params.staffId));
    if (params.branchId) conditions.push(eq(schema.salesInvoices.branchId, params.branchId));
    if (params.status) {
      if (params.status === "paid") {
        conditions.push(or(eq(schema.salesInvoices.status, "paid"), eq(schema.salesInvoices.status, "confirmed")));
      } else {
        conditions.push(eq(schema.salesInvoices.status, params.status as any));
      }
    }
    if (params.search) conditions.push(ilike(schema.salesInvoices.invoiceNo, `%${params.search}%`));
    if (params.from) conditions.push(gte(schema.salesInvoices.createdAt, new Date(params.from)));
    if (params.to) {
      // When only a date is provided (no time), include the full day
      const toDate = new Date(params.to);
      if (!params.to.includes("T")) toDate.setHours(23, 59, 59, 999);
      conditions.push(lte(schema.salesInvoices.createdAt, toDate));
    }

    const where = conditions.length ? and(...conditions) : undefined;
    const [items, [countRow]] = await Promise.all([
      this.db
        .select({
          id: schema.salesInvoices.id,
          invoiceNo: schema.salesInvoices.invoiceNo,
          patientId: schema.salesInvoices.patientId,
          patientName: schema.patients.name,
          staffId: schema.salesInvoices.staffId,
          branchId: schema.salesInvoices.branchId,
          subtotal: schema.salesInvoices.subtotal,
          discountAmount: schema.salesInvoices.discountAmount,
          taxAmount: schema.salesInvoices.taxAmount,
          totalAmount: schema.salesInvoices.totalAmount,
          amountPaid: schema.salesInvoices.amountPaid,
          amountDue: schema.salesInvoices.amountDue,
          paymentMode: schema.salesInvoices.paymentMode,
          status: schema.salesInvoices.status,
          createdAt: schema.salesInvoices.createdAt,
        })
        .from(schema.salesInvoices)
        .leftJoin(schema.patients, eq(schema.salesInvoices.patientId, schema.patients.id))
        .where(where)
        .orderBy(desc(schema.salesInvoices.createdAt))
        .limit(params.limit)
        .offset((params.page - 1) * params.limit),
      this.db.select({ count: sql<number>`count(*)::int` }).from(schema.salesInvoices).where(where),
    ]);

    const invoiceIds = items.map((i) => i.id);
    const itemsMap: Record<string, any[]> = {};
    if (invoiceIds.length > 0) {
      const lineItems = await this.db.query.salesInvoiceItems.findMany({
        where: inArray(schema.salesInvoiceItems.invoiceId, invoiceIds),
        with: { medicine: true },
      });
      lineItems.forEach((it) => {
        if (it.invoiceId) {
          if (!itemsMap[it.invoiceId]) itemsMap[it.invoiceId] = [];
          itemsMap[it.invoiceId]!.push(it);
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

  /**
   * Every customer invoice still carrying a due — the receivables book.
   * Drafts and cancelled invoices are not debts, and a return invoice carries
   * a negative total that can never leave a positive due, so all three are
   * excluded. Unpaginated on purpose: an aging total that stopped at page 1
   * would understate what is owed to the business.
   */
  async openReceivables(branchId?: string) {
    const conditions: any[] = [
      sql`${schema.salesInvoices.amountDue} > 0`,
      sql`${schema.salesInvoices.status} NOT IN ('draft', 'cancelled')`,
      eq(schema.salesInvoices.isReturn, false),
    ];
    if (branchId) conditions.push(eq(schema.salesInvoices.branchId, branchId));

    return this.db
      .select({
        id: schema.salesInvoices.id,
        invoiceNo: schema.salesInvoices.invoiceNo,
        patientId: schema.salesInvoices.patientId,
        patientName: schema.patients.name,
        patientPhone: schema.patients.phone,
        branchId: schema.salesInvoices.branchId,
        totalAmount: schema.salesInvoices.totalAmount,
        amountPaid: schema.salesInvoices.amountPaid,
        amountDue: schema.salesInvoices.amountDue,
        createdAt: schema.salesInvoices.createdAt,
      })
      .from(schema.salesInvoices)
      .leftJoin(schema.patients, eq(schema.salesInvoices.patientId, schema.patients.id))
      .where(and(...conditions))
      .orderBy(asc(schema.salesInvoices.createdAt));
  }

  /**
   * The two sides of one patient's account statement: invoices raised and
   * payments collected, oldest first. Draft and cancelled invoices are left
   * out along with their payments — neither is a real movement on the
   * account, and including them would make the running balance disagree with
   * the patient's stored outstanding.
   */
  async getPatientLedgerRows(patientId: string) {
    const invoices = await this.db
      .select({
        id: schema.salesInvoices.id,
        invoiceNo: schema.salesInvoices.invoiceNo,
        isReturn: schema.salesInvoices.isReturn,
        totalAmount: schema.salesInvoices.totalAmount,
        amountDue: schema.salesInvoices.amountDue,
        status: schema.salesInvoices.status,
        createdAt: schema.salesInvoices.createdAt,
      })
      .from(schema.salesInvoices)
      .where(
        and(
          eq(schema.salesInvoices.patientId, patientId),
          sql`${schema.salesInvoices.status} NOT IN ('draft', 'cancelled')`,
        ),
      )
      .orderBy(asc(schema.salesInvoices.createdAt));

    if (invoices.length === 0) return { invoices, payments: [] as any[] };

    const payments = await this.db
      .select({
        id: schema.payments.id,
        invoiceId: schema.payments.invoiceId,
        invoiceNo: schema.salesInvoices.invoiceNo,
        amount: schema.payments.amount,
        mode: schema.payments.mode,
        referenceNo: schema.payments.referenceNo,
        createdAt: schema.payments.createdAt,
      })
      .from(schema.payments)
      .innerJoin(schema.salesInvoices, eq(schema.payments.invoiceId, schema.salesInvoices.id))
      .where(inArray(schema.payments.invoiceId, invoices.map((i) => i.id)))
      .orderBy(asc(schema.payments.createdAt));

    return { invoices, payments };
  }

  async findById(id: string) {
    return this.db.query.salesInvoices.findFirst({
      where: eq(schema.salesInvoices.id, id),
      with: {
        // The batch is joined in because the line stores only batchId. When a
        // recall lands or a patient reacts, the question is which physical pack
        // they were handed — that is the batch number and its expiry, and
        // without this the invoice could not answer it.
        items: { with: { medicine: true, batch: true } },
        patient: true,
        payments: true,
      },
    });
  }

  async voidInvoice(id: string) {
    const [inv] = await this.db.update(schema.salesInvoices).set({ status: "cancelled", updatedAt: new Date() }).where(eq(schema.salesInvoices.id, id)).returning();
    return inv!;
  }

  async recordPayment(data: typeof schema.payments.$inferInsert, tx?: any) {
    const db = tx ?? this.db;
    const [payment] = await db.insert(schema.payments).values(data).returning();
    // Amount clamps at zero — the service layer already rejects over-payment,
    // so the GREATEST is a belt-and-suspenders against a race where two
    // concurrent settlements both read the same amountDue.
    await db.update(schema.salesInvoices).set({
      amountPaid: sql`${schema.salesInvoices.amountPaid} + ${data.amount}`,
      amountDue: sql`GREATEST(${schema.salesInvoices.amountDue} - ${data.amount}, 0)`,
      updatedAt: new Date(),
    }).where(eq(schema.salesInvoices.id, data.invoiceId));
    return payment!;
  }

  /** Flips status to "paid" once amountDue reaches zero. Only touches
   *  partially_paid rows so a manual status override or a return-in-progress
   *  invoice does not get silently marked paid. */
  async markInvoicePaid(invoiceId: string, tx?: any) {
    const db = tx ?? this.db;
    await db.update(schema.salesInvoices).set({
      status: "paid",
      updatedAt: new Date(),
    }).where(
      and(
        eq(schema.salesInvoices.id, invoiceId),
        eq(schema.salesInvoices.status, "partially_paid"),
      ),
    );
  }

  async findReturnedQuantities(originalInvoiceId: string): Promise<Record<string, number>> {
    // Find all return invoices linked to this original invoice
    const returnInvoices = await this.db
      .select({ id: schema.salesInvoices.id })
      .from(schema.salesInvoices)
      .where(
        and(
          eq(schema.salesInvoices.originalInvoiceId, originalInvoiceId),
          eq(schema.salesInvoices.isReturn, true),
        )
      );

    if (returnInvoices.length === 0) return {};

    const returnInvoiceIds = returnInvoices.map((r) => r.id);

    // Sum quantities per (medicineId, batchId) pair across all return invoices
    const returnedItems = await this.db
      .select({
        medicineId: schema.salesInvoiceItems.medicineId,
        batchId: schema.salesInvoiceItems.batchId,
        totalReturned: sql<number>`sum(${schema.salesInvoiceItems.quantity})::int`,
      })
      .from(schema.salesInvoiceItems)
      .where(inArray(schema.salesInvoiceItems.invoiceId, returnInvoiceIds))
      .groupBy(schema.salesInvoiceItems.medicineId, schema.salesInvoiceItems.batchId);

    // Return as a map keyed by "medicineId:batchId" for lookup by the service
    return returnedItems.reduce((acc, row) => {
      acc[`${row.medicineId}:${row.batchId}`] = row.totalReturned ?? 0;
      return acc;
    }, {} as Record<string, number>);
  }

  async endOfDaySummary(branchId: string | undefined, date: string) {
    const result = await this.db.execute(sql`
      SELECT
        COUNT(*)::int            AS "totalInvoices",
        COALESCE(SUM(CAST(total_amount    AS FLOAT)), 0) AS "totalSales",
        COALESCE(SUM(CAST(tax_amount      AS FLOAT)), 0) AS "totalTax",
        COALESCE(SUM(CAST(discount_amount AS FLOAT)), 0) AS "totalDiscounts"
      FROM sales_invoices
      WHERE DATE(created_at) = ${date}
        AND status != 'cancelled'
        ${branchId ? sql`AND branch_id = ${branchId}` : sql``}
    `);
    const rows = (result as any).rows ?? result;
    const row = Array.isArray(rows) ? rows[0] : undefined;
    return {
      totalInvoices: Number(row?.totalInvoices ?? 0),
      totalSales:    Number(row?.totalSales    ?? 0),
      totalTax:      Number(row?.totalTax      ?? 0),
      totalDiscounts: Number(row?.totalDiscounts ?? 0),
    };
  }
}
