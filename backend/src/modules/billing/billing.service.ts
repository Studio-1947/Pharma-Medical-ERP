import { Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DrizzleService } from "../../database/drizzle.service";
import { BillingRepository } from "./billing.repository";
import { TaxService } from "./tax.service";
import { BatchRepository } from "../inventory/batch.repository";
import { StockMovementRepository } from "../inventory/stock-movement.repository";
import * as schema from "../../database/schema";
import type { CreateInvoiceDto, QueryInvoiceDto, VoidInvoiceDto, RecordPaymentDto } from "@pharmerp/types";

@Injectable()
export class BillingService {
  constructor(
    private readonly repo: BillingRepository,
    private readonly drizzle: DrizzleService,
    private readonly taxService: TaxService,
    private readonly batchRepo: BatchRepository,
    private readonly movementRepo: StockMovementRepository,
  ) {}

  findAll(query: QueryInvoiceDto) { return this.repo.findPaginated(query); }

  async findOne(id: string) {
    const inv = await this.repo.findById(id);
    if (!inv) throw new NotFoundException(`Invoice ${id} not found`);
    return { data: inv };
  }

  /**
   * Creates an invoice atomically:
   * 1. Calculate line totals with GST
   * 2. Decrement batch quantities (FEFO already selected by client from GET /batches)
   * 3. Log stock movements
   * 4. Insert invoice + items in single transaction
   */
  async create(dto: CreateInvoiceDto, staffId: string) {
    // Pre-calculate line items with tax
    const lines = dto.items.map((item) => {
      const { lineTotal, taxAmount, breakdown } = this.taxService.calculateLineTax(
        parseFloat(item.unitPrice),
        item.quantity,
        parseFloat(item.discountPct ?? "0"),
        parseFloat(item.taxPct ?? "0"),
      );
      return { ...item, lineTotal, taxAmount, taxableAmount: breakdown.taxableAmount };
    });

    const { subtotal, taxAmount, totalAmount } = this.taxService.aggregateInvoiceTotals(lines);
    const discountAmount = parseFloat(dto.discountAmount ?? "0");
    const finalTotal = totalAmount - discountAmount;

    // Look up branch code for invoice number prefix
    const [branch] = await this.drizzle.db
      .select({ code: schema.branches.code })
      .from(schema.branches)
      .where(eq(schema.branches.id, dto.branchId));

    if (!branch) {
      throw new NotFoundException(`Branch ${dto.branchId} not found`);
    }

    const invoiceNo = await this.repo.nextInvoiceNumber(dto.branchId, branch.code);

    const result = await this.drizzle.db.transaction(async (tx) => {
      // Decrement stock for each item
      for (const line of lines) {
        const updated = await this.batchRepo.adjustQuantity(line.batchId, -line.quantity, tx as any);
        if (!updated) {
          throw new UnprocessableEntityException(
            `Insufficient stock in batch ${line.batchId}`,
          );
        }
        await this.movementRepo.log({
          batchId: line.batchId,
          medicineId: line.medicineId,
          movementType: "sale",
          quantity: -line.quantity,
          performedBy: staffId,
          referenceType: "invoice",
        }, tx);
      }

      const invoiceData: typeof schema.salesInvoices.$inferInsert = {
        invoiceNo,
        patientId: dto.patientId,
        staffId,
        branchId: dto.branchId,
        prescriptionId: dto.prescriptionId,
        subtotal: subtotal.toFixed(2),
        discountAmount: discountAmount.toFixed(2),
        taxAmount: taxAmount.toFixed(2),
        totalAmount: finalTotal.toFixed(2),
        amountPaid: "0",
        amountDue: finalTotal.toFixed(2),
        paymentMode: dto.paymentMode as any,
        status: "confirmed",
        notes: dto.notes,
        isOfflineSync: dto.isOfflineSync,
      };

      const itemsData = lines.map((line) => ({
        medicineId: line.medicineId,
        batchId: line.batchId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountPct: line.discountPct ?? "0",
        taxPct: line.taxPct ?? "0",
        lineTotal: line.lineTotal.toFixed(2),
      }));

      return this.repo.createInvoiceWithItems(invoiceData, itemsData, tx);
    });

    return { data: result.invoice, message: "Invoice created" };
  }

  async voidInvoice(id: string, dto: VoidInvoiceDto, userId: string) {
    const existing = await this.findOne(id);
    if (existing.data.status === "cancelled") {
      throw new UnprocessableEntityException("Invoice already voided");
    }
    // Return stock
    await this.drizzle.db.transaction(async (tx) => {
      for (const item of existing.data.items) {
        await this.batchRepo.adjustQuantity(item.batchId, item.quantity, tx as any);
        await this.movementRepo.log({
          batchId: item.batchId,
          medicineId: item.medicineId,
          movementType: "return",
          quantity: item.quantity,
          performedBy: userId,
          referenceId: id,
          referenceType: "invoice_void",
          notes: dto.reason,
        }, tx);
      }
      await this.repo.voidInvoice(id);
    });
    return { message: "Invoice voided" };
  }

  async recordPayment(dto: RecordPaymentDto, staffId: string) {
    const inv = await this.repo.findById(dto.invoiceId);
    if (!inv) throw new NotFoundException(`Invoice ${dto.invoiceId} not found`);
    const payment = await this.repo.recordPayment({
      invoiceId: dto.invoiceId,
      amount: dto.amount,
      mode: dto.mode as any,
      referenceNo: dto.referenceNo,
      processedBy: staffId,
    });
    return { data: payment, message: "Payment recorded" };
  }

  async endOfDaySummary(branchId: string, date?: string) {
    const d = date ?? new Date().toISOString().split("T")[0]!;
    const summary = await this.repo.endOfDaySummary(branchId, d);
    return { data: summary };
  }
}
