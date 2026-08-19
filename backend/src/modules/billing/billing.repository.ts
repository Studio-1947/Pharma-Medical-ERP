import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { DrizzleService } from "../../database/drizzle.service";
import * as schema from "../../database/schema";
import type { QueryInvoiceDto } from "@pharmerp/types";

@Injectable()
export class BillingRepository {
  constructor(private readonly drizzle: DrizzleService) {}
  private get db() {
    return this.drizzle.db;
  }

  /**
   * Allocates the next invoice number for a branch, inside the caller's
   * transaction.
   *
   * Must be given the transaction handle. The number has to be allocated by the
   * same transaction that writes the invoice, so that a sale which fails after
   * this point gives the number back instead of burning it — GST requires the
   * series to be consecutive, and a gap left by a rolled-back sale cannot be
   * explained later because nothing recorded it. It previously came from a
   * Redis INCR outside the transaction, which both leaked numbers on rollback
   * and re-issued them from 1 whenever the key was lost.
   *
   * The upsert takes a row lock, so concurrent checkouts at one branch queue
   * behind each other for the rest of the transaction. That is inherent to a
   * gapless series and the transaction is short; different branches never
   * contend, because the lock is per branch and day.
   */
  async nextInvoiceNumber(branchId: string, tx: any): Promise<string> {
    if (!branchId) {
      throw new Error("branchId is required to allocate an invoice number");
    }
    if (!tx) {
      throw new Error(
        "nextInvoiceNumber must run inside the transaction that writes the invoice",
      );
    }

    const today = new Date().toISOString().split("T")[0]!; // YYYY-MM-DD

    const [branch] = await tx
      .select({ code: schema.branches.code })
      .from(schema.branches)
      .where(eq(schema.branches.id, branchId))
      .limit(1);
    const codePrefix = (branch?.code || "BRN01").toUpperCase();

    const [row] = await tx
      .insert(schema.invoiceSequences)
      .values({ branchId, seqDate: today, lastSeq: 1 })
      .onConflictDoUpdate({
        target: [schema.invoiceSequences.branchId, schema.invoiceSequences.seqDate],
        set: {
          lastSeq: sql`${schema.invoiceSequences.lastSeq} + 1`,
          updatedAt: new Date(),
        },
      })
      .returning({ lastSeq: schema.invoiceSequences.lastSeq });

    const seq = row?.lastSeq ?? 1;
    return `${codePrefix}-${today.replace(/-/g, "")}-${String(seq).padStart(5, "0")}`;
  }

  /**
   * The invoice a given idempotency key already produced, if any.
   *
   * Loaded with items and payments so a replayed checkout can be answered with
   * the same shape as a fresh one — the POS reprints from this response.
   */
  async findByClientRef(clientRef: string) {
    return this.db.query.salesInvoices.findFirst({
      where: eq(schema.salesInvoices.clientRef, clientRef),
      with: { items: true, payments: true },
    });
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

  /**
   * Clinic queue token for a prescription, or null when there is none.
   *
   * Invoices carry a prescriptionId but no token of their own, so the queue
   * number a patient was called by is reached through the prescription. Only
   * clinic visits have one; a walk-in pharmacy sale legitimately returns null
   * and the token row is then omitted from the printed document.
   */
  async findTokenNoByPrescription(
    prescriptionId: string | null | undefined,
  ): Promise<number | null> {
    if (!prescriptionId) return null;
    const row = await this.db.query.clinicTokens.findFirst({
      where: eq(schema.clinicTokens.prescriptionId, prescriptionId),
      columns: { tokenNo: true },
    });
    return row?.tokenNo ?? null;
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

  /**
   * Day-end takings for one branch.
   *
   * "Discounts given" has to count BOTH kinds of price reduction. Most
   * discounts at this counter are per line (`sales_invoice_items.discount_pct`
   * — that is what the POS cart and the OTC modal set); only a whole-bill
   * reduction lands in `sales_invoices.discount_amount`. Summing the invoice
   * column alone reported zero discounts on a day full of discounted sales,
   * which is exactly the figure a shop checks the till against.
   *
   * The line discount is reconstructed rather than read: no column stores it,
   * because `line_total` is already net of it.
   */
  async endOfDaySummary(branchId: string | undefined, date: string) {
    const result = await this.db.execute(sql`
      WITH day_invoices AS (
        SELECT id, total_amount, tax_amount, discount_amount
        FROM sales_invoices
        WHERE DATE(created_at) = ${date}
          AND status != 'cancelled'
          ${branchId ? sql`AND branch_id = ${branchId}` : sql``}
      )
      SELECT
        (SELECT COUNT(*)::int FROM day_invoices)                                  AS "totalInvoices",
        (SELECT COALESCE(SUM(CAST(total_amount AS FLOAT)), 0) FROM day_invoices)  AS "totalSales",
        (SELECT COALESCE(SUM(CAST(tax_amount   AS FLOAT)), 0) FROM day_invoices)  AS "totalTax",
        (SELECT COALESCE(SUM(CAST(discount_amount AS FLOAT)), 0) FROM day_invoices)
        + (
            SELECT COALESCE(SUM(
              CAST(ii.unit_price AS FLOAT) * ii.quantity
              * CAST(ii.discount_pct AS FLOAT) / 100
            ), 0)
            FROM sales_invoice_items ii
            JOIN day_invoices d ON d.id = ii.invoice_id
          )                                                                        AS "totalDiscounts"
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
