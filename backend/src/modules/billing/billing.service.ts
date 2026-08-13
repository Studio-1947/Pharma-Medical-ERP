import { Injectable, NotFoundException, Optional, UnprocessableEntityException } from "@nestjs/common";
import { and, eq, gte, inArray, ne, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { DrizzleService } from "../../database/drizzle.service";
import { BillingRepository } from "./billing.repository";
import { TaxService, TaxBreakdown } from "./tax.service";
import { BatchRepository } from "../inventory/batch.repository";
import { StockMovementRepository } from "../inventory/stock-movement.repository";
import { PatientsRepository } from "../patients/patients.repository";
import { S3Service } from "../../common/s3/s3.service";
import { ClickHouseService } from "../../common/clickhouse/clickhouse.service";
import { InvoicePdfService } from "./invoice-pdf.service";
import { AuditService } from "../../common/audit/audit.service";
import { AuditAction } from "../../common/audit/audit-actions";
import { NotificationsService } from "../notifications/notifications.service";
import * as schema from "../../database/schema";
import type {
  CreateInvoiceDto,
  InvoiceItemDto,
  QueryInvoiceDto,
  VoidInvoiceDto,
  ReturnInvoiceDto,
  SaleEventDto,
} from "@pharmerp/types";

interface MedicineSnapshot {
  id: string;
  name: string;
  scheduleClass: string | null;
  requiresPrescription: boolean;
  taxPercent: string;
  stripSize: number | null;
  isActive: boolean;
}

interface BatchAllocation {
  batchId: string;
  batchNo: string;
  expiryDate: string;
  allocate: number;
  mrpAtEntry: string;
}

interface RawAllocation {
  item: InvoiceItemDto;
  med: MedicineSnapshot;
  allocation: BatchAllocation;
}

interface AllocationLine extends BatchAllocation {
  item: InvoiceItemDto;
  med: MedicineSnapshot;
  lineTotal: number;
  taxAmount: number;
  breakdown: TaxBreakdown;
  taxableAmount: number;
}

@Injectable()
export class BillingService {
  constructor(
    private readonly repo: BillingRepository,
    private readonly drizzle: DrizzleService,
    private readonly taxService: TaxService,
    private readonly batchRepo: BatchRepository,
    private readonly movementRepo: StockMovementRepository,
    private readonly patientsRepo: PatientsRepository,
    private readonly s3: S3Service,
    private readonly clickhouse: ClickHouseService,
    private readonly pdfService: InvoicePdfService,
    private readonly audit?: AuditService,
    @Optional() private readonly notificationsService?: NotificationsService,
  ) {}

  findAll(query: QueryInvoiceDto) { return this.repo.findPaginated(query); }

  async findOne(id: string) {
    const inv = await this.repo.findById(id);
    if (!inv) throw new NotFoundException(`Invoice ${id} not found`);
    return { data: inv };
  }

  /**
   * Phase 2 Rewrite: Creates a legally compliant invoice atomically.
   * Includes Schedule H gate, FEFO selection, server-side price enforcement,
   * GST split, and split payments.
   */
  async create(dto: CreateInvoiceDto, staffId: string, branchId: string) {
    const result = await this.drizzle.db.transaction(async (tx) => {
      const interState = false;

      // 1. Load all medicines and check Schedule H gate
      const medicineIds = dto.items.map(i => i.medicineId);
      const medicines = await tx
        .select({
          id: schema.medicines.id,
          name: schema.medicines.name,
          scheduleClass: schema.medicines.scheduleClass,
          requiresPrescription: schema.medicines.requiresPrescription,
          taxPercent: schema.medicines.taxPercent,
          stripSize: schema.medicines.stripSize,
          isActive: schema.medicines.isActive,
        })
        .from(schema.medicines)
        .where(inArray(schema.medicines.id, medicineIds));

      // Invoice-level checks that don't vary per line item — fetch once
      // instead of once per controlled-drug item.
      const today = new Date().toISOString().split("T")[0]!;

      let rx: { id: string; status: string; expiryDate: string | null } | null = null;
      const rxItemsByMedicine = new Map<string, {
        id: string;
        medicineId: string | null;
        quantityPrescribed: number | null;
        quantityDispensed: number;
        isFullyDispensed: boolean;
      }>();
      if (dto.prescriptionId) {
        const [rxRow] = await tx
          .select({
            id: schema.prescriptions.id,
            status: schema.prescriptions.status,
            expiryDate: schema.prescriptions.expiryDate,
          })
          .from(schema.prescriptions)
          .where(eq(schema.prescriptions.id, dto.prescriptionId));
        rx = rxRow ?? null;

        const rxItemRows = await tx
          .select({
            id: schema.prescriptionItems.id,
            medicineId: schema.prescriptionItems.medicineId,
            quantityPrescribed: schema.prescriptionItems.quantityPrescribed,
            quantityDispensed: schema.prescriptionItems.quantityDispensed,
            isFullyDispensed: schema.prescriptionItems.isFullyDispensed,
          })
          .from(schema.prescriptionItems)
          .where(
            and(
              eq(schema.prescriptionItems.prescriptionId, dto.prescriptionId),
              inArray(schema.prescriptionItems.medicineId, medicineIds),
            ),
          );
        for (const row of rxItemRows) {
          if (row.medicineId) rxItemsByMedicine.set(row.medicineId, row);
        }
      }

      if (dto.overrideReason && dto.overriddenBy) {
        const [approver] = await tx
          .select({ role: schema.users.role })
          .from(schema.users)
          .where(eq(schema.users.id, dto.overriddenBy));

        if (!approver || !["super_admin", "admin", "pharmacist"].includes(approver.role)) {
          throw new UnprocessableEntityException("Override approver must be a pharmacist or admin");
        }
      }

      for (const item of dto.items) {
        const med = medicines.find(m => m.id === item.medicineId);
        if (!med || !med.isActive) {
          throw new NotFoundException(`Medicine ${item.medicineId} not found or inactive`);
        }

        const isControlled = ["SCHEDULE_H", "SCHEDULE_H1", "SCHEDULE_X"].includes(med.scheduleClass ?? "") || med.requiresPrescription;

        if (isControlled) {
          if (!dto.prescriptionId && !dto.overrideReason) {
            throw new UnprocessableEntityException(
              `Medicine ${med.name} requires a verified prescription or manager override (Schedule ${med.scheduleClass})`
            );
          }

          if (dto.prescriptionId) {
            if (!rx || rx.status !== "verified") {
              throw new UnprocessableEntityException(`Linked prescription for ${med.name} is not verified`);
            }
            if (rx.expiryDate && rx.expiryDate < today) {
              throw new UnprocessableEntityException(`Linked prescription for ${med.name} has expired`);
            }

            const rxItem = rxItemsByMedicine.get(med.id);
            if (rxItem) {
              if (rxItem.isFullyDispensed) {
                throw new UnprocessableEntityException(`Prescription for ${med.name} has already been fully dispensed`);
              }
              if (rxItem.quantityPrescribed && (rxItem.quantityDispensed + item.quantity > rxItem.quantityPrescribed)) {
                throw new UnprocessableEntityException(
                  `Cannot dispense ${item.quantity} of ${med.name}. Only ${rxItem.quantityPrescribed - rxItem.quantityDispensed} remaining on prescription.`
                );
              }
            }
          }
        }
      }

      // 2. FEFO Batch Selection — one query for every line item instead of
      // one query per item.
      const allAllocations: RawAllocation[] = [];
      const batchAllocationsPerItem = await this.batchRepo.selectBatchesForDispenseMulti(
        dto.items.map(item => ({ medicineId: item.medicineId, needed: item.quantity })),
        // Only this branch's shelves are sellable from this till.
        branchId,
        tx,
      );
      dto.items.forEach((item, idx) => {
        const med = medicines.find(m => m.id === item.medicineId)!;
        for (const alloc of batchAllocationsPerItem[idx]!) {
          allAllocations.push({ item, med, allocation: alloc });
        }
      });

      // 3. Compute Totals & Validate Payment Sum
      const lines: AllocationLine[] = allAllocations.map(({ item, med, allocation }) => {
        const unitMrp = parseFloat(allocation.mrpAtEntry) / (med.stripSize || 1);
        const { lineTotal, taxAmount, breakdown } = this.taxService.calculateLineTax(
          unitMrp,
          allocation.allocate,
          parseFloat(item.discountPct ?? "0"),
          parseFloat(med.taxPercent),
          interState,
        );
        return {
          ...allocation,
          item,
          med,
          lineTotal,
          taxAmount,
          breakdown,
          taxableAmount: breakdown.taxableAmount
        };
      });

      const { subtotal, taxAmount, totalAmount } = this.taxService.aggregateInvoiceTotals(lines);

      // Loyalty point redemption: 100 points = ₹10 discount
      const pointsToRedeem = dto.loyaltyPointsToRedeem ?? 0;
      let loyaltyDiscount = new Decimal(0);
      if (pointsToRedeem > 0) {
        if (!dto.patientId) {
          throw new UnprocessableEntityException("Loyalty points can only be redeemed for registered patients");
        }
        if (pointsToRedeem % 100 !== 0) {
          throw new UnprocessableEntityException("Points must be redeemed in multiples of 100");
        }
        loyaltyDiscount = new Decimal(pointsToRedeem).div(10);
        // Validate patient has enough points (throws if insufficient)
        await this.patientsRepo.deductLoyaltyPoints(dto.patientId, pointsToRedeem, tx);
      }

      const discountAmount = new Decimal(dto.discountAmount ?? "0").plus(loyaltyDiscount);
      const finalTotal = new Decimal(totalAmount).minus(discountAmount).toNumber();

      if (finalTotal < 0) {
        throw new UnprocessableEntityException("Discount exceeds invoice total");
      }

      const paymentTotal = dto.payments.reduce(
        (sum, p) => new Decimal(sum).plus(p.amount).toNumber(),
        0
      );

      // Allow 0.01 tolerance for rounding if necessary, but here we expect exact match
      if (!new Decimal(paymentTotal).equals(new Decimal(finalTotal.toFixed(2)))) {
        throw new UnprocessableEntityException(
          `Payment total ${paymentTotal} does not match invoice total ${finalTotal.toFixed(2)}`
        );
      }

      // 4. Batch Deduction & Logs — the quantity UPDATE stays one-per-batch
      // (each needs its own atomic "don't oversell" guard), but the
      // stock-movement inserts are collected and written in one round trip.
      const movementRows: {
        batchId: string;
        medicineId: string;
        branchId: string;
        movementType: "sale";
        quantity: number;
        performedBy: string;
        referenceType: string;
      }[] = [];

      for (const { allocation, item } of allAllocations) {
        const [deducted] = await tx
          .update(schema.inventoryBatches)
          .set({
            quantity: sql`${schema.inventoryBatches.quantity} - ${allocation.allocate}`,
            updatedAt: new Date()
          })
          .where(
            and(
              eq(schema.inventoryBatches.id, allocation.batchId),
              gte(schema.inventoryBatches.quantity, allocation.allocate)
            )
          )
          .returning({ id: schema.inventoryBatches.id });

        if (!deducted) {
          throw new UnprocessableEntityException(
            `Concurrent depletion: batch ${allocation.batchNo} for ${item.medicineId} no longer has sufficient units`
          );
        }

        movementRows.push({
          batchId: allocation.batchId,
          medicineId: item.medicineId,
          branchId,
          movementType: "sale",
          quantity: -allocation.allocate,
          performedBy: staffId,
          referenceType: "invoice",
        });
      }

      await this.movementRepo.logMany(movementRows, tx);

      // 4.5 Update Prescription Dispensed Quantities — reuses the map
      // fetched once above instead of re-querying per item. The map is
      // updated in place so two cart lines for the same medicine
      // accumulate correctly instead of the second overwriting the first.
      if (dto.prescriptionId) {
        for (const item of dto.items) {
          const rxItem = rxItemsByMedicine.get(item.medicineId);
          if (rxItem) {
            const newDispensed = rxItem.quantityDispensed + item.quantity;
            const isFullyDispensed = rxItem.quantityPrescribed ? newDispensed >= rxItem.quantityPrescribed : false;

            await tx
              .update(schema.prescriptionItems)
              .set({
                quantityDispensed: newDispensed,
                isFullyDispensed
              })
              .where(eq(schema.prescriptionItems.id, rxItem.id));

            rxItem.quantityDispensed = newDispensed;
            rxItem.isFullyDispensed = isFullyDispensed;
          }
        }
      }

      // 5. Insert Invoice, Items, and Payments
      const invoiceNo = await this.repo.nextInvoiceNumber(branchId);

      const invoiceData: typeof schema.salesInvoices.$inferInsert = {
        invoiceNo,
        patientId: dto.patientId,
        staffId,
        branchId,
        prescriptionId: dto.prescriptionId,
        subtotal: subtotal.toFixed(2),
        discountAmount: discountAmount.toFixed(2),
        taxAmount: taxAmount.toFixed(2),
        totalAmount: finalTotal.toFixed(2),
        amountPaid: finalTotal.toFixed(2),
        amountDue: "0.00",
        paymentMode: dto.payments.length > 1 ? "mixed" : dto.payments[0]!.mode as any,
        status: "paid",
        notes: dto.notes,
        isOfflineSync: dto.isOfflineSync ?? false,
        isReturn: false,
        overrideReason: dto.overrideReason,
        overriddenBy: dto.overriddenBy,
      };

      const itemsData = lines.map(line => ({
        medicineId: line.item.medicineId,
        batchId: line.batchId,
        quantity: line.allocate,
        unitPrice: String(parseFloat(line.mrpAtEntry) / (line.med.stripSize || 1)),
        discountPct: line.item.discountPct ?? "0",
        taxPct: String(parseFloat(line.med.taxPercent)),
        lineTotal: line.lineTotal.toFixed(2),
        cgstAmt: line.breakdown.cgst.toFixed(2),
        sgstAmt: line.breakdown.sgst.toFixed(2),
        igstAmt: line.breakdown.igst.toFixed(2),
      }));

      const { invoice, items: insertedItems } = await this.repo.createInvoiceWithItems(invoiceData, itemsData, tx);

      // Insert multiple payment rows
      for (const p of dto.payments) {
        await tx.insert(schema.payments).values({
          invoiceId: invoice.id,
          amount: p.amount,
          mode: p.mode as any,
          referenceNo: p.referenceNo,
          processedBy: staffId,
        });
      }

      // 6. Accrue loyalty points (1 point per ₹100 of final total, rounded down)
      if (dto.patientId && finalTotal > 0) {
        const pointsEarned = Math.floor(finalTotal / 100);
        if (pointsEarned > 0) {
          await this.patientsRepo.addLoyaltyPoints(dto.patientId, pointsEarned, tx);
        }
      }

      return { invoice, items: insertedItems, _lines: lines as AllocationLine[] };
    });

    await this.audit?.writeSafe({
      actorId: staffId,
      action: AuditAction.INVOICE_CREATE,
      entity: "sales_invoice",
      entityId: result.invoice.id,
      newValue: { invoiceNo: result.invoice.invoiceNo, totalAmount: result.invoice.totalAmount },
    });

    // 7. PDF is generated on first request to /invoices/:id/pdf (synchronous, on-demand)

    // 8. Emit sale events to ClickHouse — fire-and-forget, never blocks the response
    const paymentMode = dto.payments.length > 1 ? "mixed" : dto.payments[0]!.mode;
    const now = new Date().toISOString();
    const saleEvents: SaleEventDto[] = result._lines.map((line: AllocationLine) => ({
      invoiceId: result.invoice.id,
      invoiceNo: result.invoice.invoiceNo,
      medicineId: line.item.medicineId,
      medicineName: line.med.name,
      batchId: line.batchId,
      quantity: line.allocate,
      unitPrice: parseFloat(line.mrpAtEntry) / (line.med.stripSize || 1),
      lineTotal: parseFloat(line.lineTotal.toFixed(2)),
      taxAmount: parseFloat(line.taxAmount.toFixed(2)),
      paymentMode: paymentMode as SaleEventDto["paymentMode"],
      branchId,
      staffId,
      patientId: dto.patientId,
      createdAt: now,
    }));
    this.clickhouse.insertSaleEvents(saleEvents); // intentionally not awaited

    if (this.notificationsService) {
      await this.notificationsService.create({
        type: "invoice",
        title: `Sales Invoice Issued (${result.invoice.invoiceNo})`,
        message: `Invoice #${result.invoice.invoiceNo} issued for ₹${result.invoice.totalAmount}.`,
        resourceType: "invoice",
        resourceId: result.invoice.id,
      });
    }

    return { invoice: result.invoice, items: result.items };
  }

  async voidInvoice(id: string, dto: VoidInvoiceDto, userId: string) {
    const existing = await this.findOne(id);
    // Return stock inside transaction — use a conditional status update as
    // a mutex so that concurrent void calls cannot double-return stock.
    await this.drizzle.db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(schema.salesInvoices)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(and(eq(schema.salesInvoices.id, id), ne(schema.salesInvoices.status, "cancelled")))
        .returning({ id: schema.salesInvoices.id });

      if (!claimed) {
        throw new UnprocessableEntityException("Invoice already voided");
      }

      for (const item of existing.data.items) {
        await tx
          .update(schema.inventoryBatches)
          .set({
            quantity: sql`${schema.inventoryBatches.quantity} + ${item.quantity}`,
            updatedAt: new Date(),
          })
          .where(eq(schema.inventoryBatches.id, item.batchId));

        await this.movementRepo.log({
          batchId: item.batchId,
          medicineId: item.medicineId,
          // Stock returns to the branch that raised the invoice.
          branchId: existing.data.branchId,
          movementType: "return",
          quantity: item.quantity,
          performedBy: userId,
          referenceId: id,
          referenceType: "invoice_void",
          notes: dto.reason,
        }, tx);
      }
    });

    await this.audit?.writeSafe({
      actorId: userId,
      action: AuditAction.INVOICE_VOID,
      entity: "sales_invoice",
      entityId: id,
      oldValue: { status: existing.data.status, invoiceNo: existing.data.invoiceNo },
      newValue: { status: "cancelled", reason: dto.reason },
    });

    return { message: "Invoice voided" };
  }

  async createReturn(originalInvoiceId: string, dto: ReturnInvoiceDto, staffId: string) {
    // Load original invoice with items and payments
    const original = await this.repo.findById(originalInvoiceId);
    if (!original) throw new NotFoundException(`Invoice ${originalInvoiceId} not found`);
    if (original.status !== "confirmed") {
      throw new UnprocessableEntityException("Only confirmed invoices can be returned");
    }

    // Get already-returned quantities (keyed by "medicineId:batchId")
    const returnedMap = await this.repo.findReturnedQuantities(originalInvoiceId);

    // Validate each return item against original quantities
    const returnLineData: Array<{
      originalItem: any;
      returnQty: number;
      lineTotal: number;
      cgstAmt: number; 
      sgstAmt: number; 
      igstAmt: number;
    }> = [];

    for (const returnItem of dto.items) {
      const originalItem = original.items.find(i => i.id === returnItem.invoiceItemId);
      if (!originalItem) {
        throw new NotFoundException(`Invoice item ${returnItem.invoiceItemId} not found on original invoice`);
      }
      const alreadyReturned = returnedMap[`${originalItem.medicineId}:${originalItem.batchId}`] ?? 0;
      const remaining = originalItem.quantity - alreadyReturned;
      if (returnItem.returnQty > remaining) {
        throw new UnprocessableEntityException(
          `Cannot return ${returnItem.returnQty} units of item ${returnItem.invoiceItemId}: only ${remaining} units eligible for return`,
        );
      }

      // Prorate line totals by return fraction
      const fraction = returnItem.returnQty / originalItem.quantity;
      returnLineData.push({
        originalItem,
        returnQty: returnItem.returnQty,
        lineTotal: -(parseFloat(originalItem.lineTotal) * fraction),
        cgstAmt: -(parseFloat(originalItem.cgstAmt) * fraction),
        sgstAmt: -(parseFloat(originalItem.sgstAmt) * fraction),
        igstAmt: -(parseFloat(originalItem.igstAmt) * fraction),
      });
    }

    const returnTotal = returnLineData.reduce((sum, l) => sum + l.lineTotal, 0);

    const returnInvoiceNo = await this.repo.nextInvoiceNumber(original.branchId);

    // Determine refund payment mode from original invoice
    const refundMode = original.payments?.[0]?.mode ?? "cash";

    return this.drizzle.db.transaction(async (tx) => {
      // Restock batches + log movements
      for (const line of returnLineData) {
        await tx
          .update(schema.inventoryBatches)
          .set({
            quantity: sql`${schema.inventoryBatches.quantity} + ${line.returnQty}`,
            updatedAt: new Date(),
          })
          .where(eq(schema.inventoryBatches.id, line.originalItem.batchId));

        await this.movementRepo.log({
          batchId: line.originalItem.batchId,
          medicineId: line.originalItem.medicineId,
          branchId: original.branchId,
          movementType: "return",
          quantity: line.returnQty,   // positive = restock
          performedBy: staffId,
          referenceId: originalInvoiceId,
          referenceType: "invoice_return",
          notes: dto.reason,
        }, tx);
      }

      // Create return invoice
      const returnInvoiceData: typeof schema.salesInvoices.$inferInsert = {
        invoiceNo: returnInvoiceNo,
        patientId: original.patientId,
        staffId,
        // A credit note belongs to the branch that made the original sale, so
        // the refund nets off against that branch's revenue and not another's.
        branchId: original.branchId,
        prescriptionId: original.prescriptionId,
        subtotal: returnTotal.toFixed(2),
        discountAmount: "0.00",
        taxAmount: returnLineData.reduce((s, l) => s + l.cgstAmt + l.sgstAmt + l.igstAmt, 0).toFixed(2),
        totalAmount: returnTotal.toFixed(2),
        amountPaid: returnTotal.toFixed(2),
        amountDue: "0.00",
        paymentMode: refundMode as any,
        status: "confirmed",
        notes: dto.reason,
        isOfflineSync: false,
        isReturn: true,
        originalInvoiceId,
      };

      const returnItems = returnLineData.map(line => ({
        medicineId: line.originalItem.medicineId,
        batchId: line.originalItem.batchId,
        quantity: line.returnQty,
        unitPrice: line.originalItem.unitPrice,
        discountPct: line.originalItem.discountPct,
        taxPct: line.originalItem.taxPct,
        lineTotal: line.lineTotal.toFixed(2),
        cgstAmt: line.cgstAmt.toFixed(2),
        sgstAmt: line.sgstAmt.toFixed(2),
        igstAmt: line.igstAmt.toFixed(2),
      }));

      const { invoice: returnInvoice, items: returnInsertedItems } =
        await this.repo.createInvoiceWithItems(returnInvoiceData, returnItems, tx);

      // Refund payment row (negative amount)
      await tx.insert(schema.payments).values({
        invoiceId: returnInvoice.id,
        amount: returnTotal.toFixed(2),   // negative string e.g. "-150.00"
        mode: refundMode as any,
        processedBy: staffId,
      });

      return { data: { invoice: returnInvoice, items: returnInsertedItems }, message: "Return processed" };
    });
  }

  async recordPayment(dto: any, staffId: string) {
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

  async endOfDaySummary(branchId: string | undefined, date?: string) {
    const d = date ?? new Date().toISOString().slice(0, 10);
    const summary = await this.repo.endOfDaySummary(branchId, d);
    return { data: summary };
  }

  async getPdfUrl(invoiceId: string) {
    const inv = await this.repo.findById(invoiceId);
    if (!inv) throw new NotFoundException(`Invoice ${invoiceId} not found`);

    const key = inv.pdfUrl ?? await this.pdfService.generateAndUpload(invoiceId);
    const url = await this.s3.getPresignedUrl(key, 300);
    return { ready: true, url };
  }
}
