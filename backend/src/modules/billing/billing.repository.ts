import { Injectable } from "@nestjs/common";
import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { DrizzleService } from "../../database/drizzle.service";
import * as schema from "../../database/schema";
import type { QueryInvoiceDto } from "@pharmerp/types";

@Injectable()
export class BillingRepository {
  constructor(private readonly drizzle: DrizzleService) {}
  private get db() { return this.drizzle.db; }

  async nextInvoiceNumber(branchId: string, branchCode: string): Promise<string> {
    const today = new Date().toISOString().split("T")[0]!;
    const result = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.salesInvoices)
      .where(and(eq(schema.salesInvoices.branchId, branchId), sql`DATE(created_at) = CURRENT_DATE`));
    const count = result[0]?.count ?? 0;
    const seq = String(count + 1).padStart(4, "0");
    return `${branchCode.toUpperCase()}-${today.replace(/-/g, "")}-${seq}`;
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
    if (params.status) conditions.push(eq(schema.salesInvoices.status, params.status as any));
    if (params.from) conditions.push(gte(schema.salesInvoices.createdAt, new Date(params.from)));
    if (params.to) conditions.push(lte(schema.salesInvoices.createdAt, new Date(params.to)));

    const where = conditions.length ? and(...conditions) : undefined;
    const [items, [countRow]] = await Promise.all([
      this.db.select().from(schema.salesInvoices).where(where)
        .orderBy(desc(schema.salesInvoices.createdAt))
        .limit(params.limit).offset((params.page - 1) * params.limit),
      this.db.select({ count: sql<number>`count(*)::int` }).from(schema.salesInvoices).where(where),
    ]);
    return { data: items, meta: { page: params.page, limit: params.limit, total: countRow?.count ?? 0, totalPages: Math.ceil((countRow?.count ?? 0) / params.limit) } };
  }

  async findById(id: string) {
    return this.db.query.salesInvoices.findFirst({
      where: eq(schema.salesInvoices.id, id),
      with: { items: { with: { medicine: true } }, patient: true, payments: true },
    });
  }

  async voidInvoice(id: string) {
    const [inv] = await this.db.update(schema.salesInvoices).set({ status: "cancelled", updatedAt: new Date() }).where(eq(schema.salesInvoices.id, id)).returning();
    return inv!;
  }

  async recordPayment(data: typeof schema.payments.$inferInsert) {
    const [payment] = await this.db.insert(schema.payments).values(data).returning();
    // update amountPaid and amountDue
    await this.db.update(schema.salesInvoices).set({
      amountPaid: sql`${schema.salesInvoices.amountPaid} + ${data.amount}`,
      amountDue: sql`${schema.salesInvoices.amountDue} - ${data.amount}`,
      updatedAt: new Date(),
    }).where(eq(schema.salesInvoices.id, data.invoiceId));
    return payment!;
  }

  async endOfDaySummary(branchId: string, date: string) {
    const result = await this.db.execute(sql`
      SELECT
        COUNT(*)::int AS invoice_count,
        COALESCE(SUM(total_amount), 0)::numeric AS total_sales,
        COALESCE(SUM(tax_amount), 0)::numeric AS total_tax,
        COALESCE(SUM(discount_amount), 0)::numeric AS total_discounts
      FROM sales_invoices
      WHERE branch_id = ${branchId}
        AND DATE(created_at) = ${date}
        AND status != 'cancelled'
    `);
    const row = result.rows ? result.rows[0] : (Array.isArray(result) ? result[0] : undefined);
    return row;
  }
}
