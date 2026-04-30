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
    // 1. Look up branch code for invoice number prefix
    const [branch] = await this.drizzle.db
      .select({ code: schema.branches.code })
      .from(schema.branches)
      .where(eq(schema.branches.id, dto.branchId));

    if (!branch) {
      throw new NotFoundException(`Branch ${dto.branchId} not found`);
    }

    const invoiceNo = await this.repo.nextInvoiceNumber(dto.branchId, branch.code);
    const discountAmountTotal = parseFloat(dto.discountAmount ?? "0");

    const result = await this.drizzle.db.transaction(async (tx) => {
      const allLines: any[] = [];

      for (const item of dto.items) {
        // Fetch medicine for tax info
        const [medicine] = await tx
          .select({ taxPercent: schema.medicines.taxPercent })
          .from(schema.medicines)
          .where(eq(schema.medicines.id, item.medicineId));

        if (!medicine) {
          throw new NotFoundException(`Medicine ${item.medicineId} not found`);
        }

        // FEFO Selection - throws if insufficient stock
        const allocations = await this.batchRepo.selectBatchesForDispense(
          item.medicineId,
          dto.branchId,
          item.quantity,
          tx,
        );

        for (const alloc of allocations) {
          const { lineTotal, taxAmount, breakdown } = this.taxService.calculateLineTax(
            parseFloat(alloc.mrpAtEntry),
            alloc.allocate,
            parseFloat(item.discountPct ?? "0"),
            parseFloat(medicine.taxPercent ?? "0"),
          );

          allLines.push({
            medicineId: item.medicineId,
            batchId: alloc.batchId,
            quantity: alloc.allocate,
            unitPrice: alloc.mrpAtEntry,
            discountPct: item.discountPct ?? "0",
            taxPct: medicine.taxPercent ?? "0",
            lineTotal,
            taxAmount,
            taxableAmount: breakdown.taxableAmount,
            cgstAmt: breakdown.cgst.toFixed(2),
            sgstAmt: breakdown.sgst.toFixed(2),
            igstAmt: breakdown.igst.toFixed(2),
          });

          // Adjust stock (atomic decrement)
          const updatedBatch = await this.batchRepo.adjustQuantity(alloc.batchId, -alloc.allocate, tx as any);
          if (!updatedBatch) {
            throw new UnprocessableEntityException(`Stock update failed for batch ${alloc.batchId}`);
          }

          // Log movement
          await this.movementRepo.log({
            batchId: alloc.batchId,
            medicineId: item.medicineId,
            movementType: "sale",
            quantity: -alloc.allocate,
            performedBy: staffId,
            referenceType: "invoice",
          }, tx);
        }
      }

      const { subtotal, taxAmount: totalTax, totalAmount } = this.taxService.aggregateInvoiceTotals(allLines);
      const finalTotal = totalAmount - discountAmountTotal;

      // Calculate paid amount from payments array
      const totalPaid = dto.payments.reduce((acc, p) => acc + parseFloat(p.amount), 0);
      const amountDue = finalTotal - totalPaid;

      // Determine primary payment mode
      let paymentMode: any = "mixed";
      if (dto.payments.length === 1 && dto.payments[0]) {
        paymentMode = dto.payments[0].mode;
      }

      const invoiceData: typeof schema.salesInvoices.$inferInsert = {
        invoiceNo,
        patientId: dto.patientId,
        staffId,
        branchId: dto.branchId,
        prescriptionId: dto.prescriptionId,
        subtotal: subtotal.toFixed(2),
        discountAmount: discountAmountTotal.toFixed(2),
        taxAmount: totalTax.toFixed(2),
        totalAmount: finalTotal.toFixed(2),
        amountPaid: totalPaid.toFixed(2),
        amountDue: amountDue.toFixed(2),
        paymentMode,
        status: amountDue <= 0 ? "paid" : "partially_paid",
        notes: dto.notes,
        isOfflineSync: dto.isOfflineSync,
        overrideReason: dto.overrideReason,
        overriddenBy: dto.overriddenBy,
      };

      const itemsData = allLines.map((line) => ({
        medicineId: line.medicineId,
        batchId: line.batchId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountPct: line.discountPct,
        taxPct: line.taxPct,
        lineTotal: line.lineTotal.toFixed(2),
        cgstAmt: line.cgstAmt,
        sgstAmt: line.sgstAmt,
        igstAmt: line.igstAmt,
      }));

      const created = await this.repo.createInvoiceWithItems(invoiceData, itemsData, tx);

      // Record detailed payments
      for (const p of dto.payments) {
        await tx.insert(schema.payments).values({
          invoiceId: created.invoice.id,
          amount: p.amount,
          mode: p.mode as any,
          referenceNo: p.referenceNo,
          processedBy: staffId,
        });
      }

      return created;
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
