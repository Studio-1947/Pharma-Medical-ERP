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
import {
  addToBucket,
  bucketBreakdown,
  daysPastDue,
  newBucketTotals,
  serializeBuckets,
  sumBuckets,
  sumOverdue,
} from "../../common/utils/aging.util";
import * as schema from "../../database/schema";
import type {
  CreateInvoiceDto,
  InvoiceItemDto,
  QueryInvoiceDto,
  VoidInvoiceDto,
  ReturnInvoiceDto,
  SaleEventDto,
  QueryPatientLedgerDto,
  QueryReceivablesAgingDto,
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
    // Printed documents show the clinic queue token above the header, so it has
    // to travel with the invoice. Null for walk-in sales, which have no token.
    const tokenNo = await this.repo.findTokenNoByPrescription(inv.prescriptionId);
    return { data: { ...inv, tokenNo } };
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

        if (!approver || !["super_admin", "admin", "shop_manager"].includes(approver.role)) {
          throw new UnprocessableEntityException("Override approver must be a shop manager or admin");
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

      // Doctor consultation fee — a service line, not a stock line. Health care
      // services are GST-exempt, so it adds to subtotal and total but carries
      // zero tax and never touches inventory or FEFO allocation.
      const feeAmount = dto.consultationFee ? new Decimal(dto.consultationFee.amount) : new Decimal(0);
      const subtotalWithFee = new Decimal(subtotal).plus(feeAmount).toNumber();
      const totalWithFee = new Decimal(totalAmount).plus(feeAmount).toNumber();

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
      const finalTotal = new Decimal(totalWithFee).minus(discountAmount).toNumber();

      if (finalTotal < 0) {
        throw new UnprocessableEntityException("Discount exceeds invoice total");
      }

      const paymentTotalDec = dto.payments.reduce(
        (sum, p) => sum.plus(p.amount),
        new Decimal(0),
      );
      const finalTotalDec = new Decimal(finalTotal.toFixed(2));

      // Over-payment is always a bug at the counter — the operator either
      // typed the wrong number or the cart changed after the modal opened.
      // Refunds are a separate return flow, not an invoice with negative due.
      if (paymentTotalDec.greaterThan(finalTotalDec)) {
        throw new UnprocessableEntityException(
          `Payment total ${paymentTotalDec.toFixed(2)} exceeds invoice total ${finalTotalDec.toFixed(2)} — issue a return instead of over-paying`,
        );
      }

      // Under-payment is the "Due billing" path: the balance becomes what the
      // patient owes. A walk-in has no account to owe against, so we still
      // require full payment for anonymous sales.
      const amountDueDec = finalTotalDec.minus(paymentTotalDec);
      const hasDue = amountDueDec.greaterThan(0);
      if (hasDue && !dto.patientId) {
        throw new UnprocessableEntityException(
          "Walk-in sales must be paid in full — register a patient to accept a partial payment as due",
        );
      }

      const invoiceStatus: "paid" | "partially_paid" = hasDue
        ? "partially_paid"
        : "paid";

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
        subtotal: subtotalWithFee.toFixed(2),
        discountAmount: discountAmount.toFixed(2),
        taxAmount: taxAmount.toFixed(2),
        totalAmount: finalTotalDec.toFixed(2),
        amountPaid: paymentTotalDec.toFixed(2),
        amountDue: amountDueDec.toFixed(2),
        paymentMode: dto.payments.length > 1 ? "mixed" : dto.payments[0]!.mode as any,
        status: invoiceStatus,
        notes: dto.notes,
        isOfflineSync: dto.isOfflineSync ?? false,
        isReturn: false,
        overrideReason: dto.overrideReason,
        overriddenBy: dto.overriddenBy,
      };

      const itemsData: Omit<typeof schema.salesInvoiceItems.$inferInsert, "invoiceId">[] = lines.map(line => ({
        itemType: "medicine",
        itemName: line.med.name,
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

      if (feeAmount.gt(0) && dto.consultationFee) {
        itemsData.push({
          itemType: "consultation",
          itemName: `Doctor Consultation — ${dto.consultationFee.doctorName}`,
          medicineId: null,
          batchId: null,
          quantity: 1,
          unitPrice: feeAmount.toFixed(2),
          discountPct: "0",
          taxPct: "0",
          lineTotal: feeAmount.toFixed(2),
          cgstAmt: "0.00",
          sgstAmt: "0.00",
          igstAmt: "0.00",
        });
      }

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

      // 7. Add the un-paid balance to the patient's dues so the counter can
      // collect it later via /billing/payments. Guarded by dto.patientId above
      // (walk-ins can't reach here with hasDue). Same-tx as the invoice so a
      // rolled-back sale never leaves an orphaned dues entry.
      if (hasDue && dto.patientId) {
        await this.patientsRepo.addOutstanding(
          dto.patientId,
          amountDueDec.toFixed(2),
          tx,
        );
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

    // The POS prints the receipt straight from this response, so the queue
    // token has to be present here rather than only on a later detail fetch.
    const tokenNo = await this.repo.findTokenNoByPrescription(
      result.invoice.prescriptionId,
    );

    return {
      invoice: { ...result.invoice, tokenNo },
      items: result.items,
    };
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
        // Consultation fee lines hold no stock — nothing to restock.
        if (!item.batchId || !item.medicineId) continue;

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
      // Restock batches + log movements. Consultation fee lines hold no stock,
      // so their refund is reflected in the credit note total only.
      for (const line of returnLineData) {
        if (!line.originalItem.batchId || !line.originalItem.medicineId) continue;

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

  /**
   * Settles part or all of an invoice's outstanding due. Rejects if the
   * invoice has no due, or if the payment would over-pay it. On success:
   * (a) inserts the payment row, (b) increments amountPaid + decrements
   * amountDue, (c) flips status to paid when amountDue hits zero, and
   * (d) decrements the patient's outstandingBalance by the same amount.
   * All four writes happen in one transaction so a mid-op failure leaves
   * neither the invoice nor the patient in a half-updated state.
   */
  async recordPayment(dto: any, staffId: string) {
    const inv = await this.repo.findById(dto.invoiceId);
    if (!inv) throw new NotFoundException(`Invoice ${dto.invoiceId} not found`);

    const currentDue = new Decimal(inv.amountDue ?? "0");
    const paymentAmt = new Decimal(dto.amount);

    if (currentDue.lessThanOrEqualTo(0)) {
      throw new UnprocessableEntityException(
        `Invoice ${inv.invoiceNo} has no outstanding due — status ${inv.status}`,
      );
    }
    if (paymentAmt.greaterThan(currentDue)) {
      throw new UnprocessableEntityException(
        `Payment ${paymentAmt.toFixed(2)} exceeds outstanding due ${currentDue.toFixed(2)} — use a return for over-collection`,
      );
    }

    const newDue = currentDue.minus(paymentAmt);
    const clearsDue = newDue.equals(0);

    const result = await this.drizzle.db.transaction(async (tx) => {
      const payment = await this.repo.recordPayment(
        {
          invoiceId: dto.invoiceId,
          amount: dto.amount,
          mode: dto.mode as any,
          referenceNo: dto.referenceNo,
          processedBy: staffId,
        },
        tx,
      );
      if (clearsDue) {
        await this.repo.markInvoicePaid(dto.invoiceId, tx);
      }
      if (inv.patientId) {
        await this.patientsRepo.deductOutstanding(
          inv.patientId,
          paymentAmt.toFixed(2),
          tx,
        );
      }
      return payment;
    });

    return {
      data: result,
      message: clearsDue ? "Payment recorded — invoice fully paid" : "Payment recorded",
    };
  }

  /**
   * Customer account statement: invoices as debits, payments as credits, with
   * a running balance — the receivables mirror of the supplier ledger.
   *
   * A return invoice carries a negative total, so it lands as a negative debit
   * and its refund row as a negative credit. That nets to zero on the balance,
   * which is correct: refunding cash for returned goods does not change what
   * the patient still owes. Modelling returns with a second sign convention
   * would have to be unwound again to reconcile.
   */
  async getPatientLedger(patientId: string, query: QueryPatientLedgerDto) {
    const patient = await this.patientsRepo.findById(patientId);
    if (!patient) throw new NotFoundException(`Patient ${patientId} not found`);

    const { invoices, payments } = await this.repo.getPatientLedgerRows(patientId);

    type Row = {
      date: Date;
      type: "invoice" | "credit_note" | "payment" | "refund";
      reference: string;
      debit: Decimal;
      credit: Decimal;
    };

    const invoiceRows: Row[] = invoices.map((inv) => ({
      date: new Date(inv.createdAt),
      type: inv.isReturn ? "credit_note" : "invoice",
      reference: inv.invoiceNo,
      debit: new Decimal(inv.totalAmount),
      credit: new Decimal(0),
    }));

    const paymentRows: Row[] = payments.map((p) => {
      const amount = new Decimal(p.amount);
      const mode = (p.mode ?? "").toUpperCase();
      return {
        date: new Date(p.createdAt),
        type: amount.isNegative() ? ("refund" as const) : ("payment" as const),
        reference: [p.invoiceNo, mode, p.referenceNo].filter(Boolean).join(" · "),
        debit: new Decimal(0),
        credit: amount,
      };
    });

    const allRows = [...invoiceRows, ...paymentRows].sort((a, b) => a.date.getTime() - b.date.getTime());

    const fromDate = query.from ? new Date(`${query.from}T00:00:00.000Z`) : null;
    const toDate = query.to ? new Date(`${query.to}T23:59:59.999Z`) : null;

    let runningBalance = new Decimal(0);
    let openingBalance = new Decimal(0);
    const entries: Array<Row & { balance: Decimal }> = [];

    for (const row of allRows) {
      runningBalance = runningBalance.plus(row.debit).minus(row.credit);
      if (fromDate && row.date < fromDate) {
        openingBalance = runningBalance;
        continue;
      }
      if (toDate && row.date > toDate) continue;
      entries.push({ ...row, balance: runningBalance });
    }

    return {
      patientId,
      patientName: patient.name,
      patientPhone: patient.phone,
      openingBalance: openingBalance.toFixed(2),
      entries: entries.map((e) => ({
        date: e.date.toISOString(),
        type: e.type,
        reference: e.reference,
        debit: e.debit.toFixed(2),
        credit: e.credit.toFixed(2),
        balance: e.balance.toFixed(2),
      })),
      closingBalance: runningBalance.toFixed(2),
      // The denormalised column the POS reads. Shown next to the computed
      // closing balance rather than instead of it: if the two ever disagree,
      // that divergence is the thing worth seeing.
      storedOutstanding: patient.outstandingBalance,
    };
  }

  /**
   * Receivables aging: open customer dues banded by how long they have been
   * outstanding, rolled up per patient.
   *
   * Patients have no credit-term field yet, so a due is treated as payable on
   * the day of sale and the ladder measures days since the invoice. When
   * customer credit terms are added, only `dueDate` below has to change — the
   * banding and totals work unaltered.
   */
  async getReceivablesAging(query: QueryReceivablesAgingDto) {
    const asOf = new Date();
    const invoices = await this.repo.openReceivables(query.branchId);

    type Group = {
      patientId: string | null;
      patientName: string;
      patientPhone: string | null;
      buckets: ReturnType<typeof newBucketTotals>;
      invoiceCount: number;
      overdueInvoiceCount: number;
      oldestInvoiceDate: string | null;
    };

    const groups = new Map<string, Group>();
    const grandTotals = newBucketTotals();
    let grandOverdueInvoices = 0;

    for (const inv of invoices) {
      const balance = new Decimal(inv.amountDue);
      if (balance.lessThanOrEqualTo(0)) continue;

      const dueDate = new Date(inv.createdAt);
      const daysOverdue = daysPastDue(dueDate, asOf);

      // A walk-in should never accrue a due (the POS only records one against
      // a named patient), but an offline sync could still land one. Bucketing
      // it under a synthetic row keeps the total honest instead of dropping it.
      const key = inv.patientId ?? "__unassigned__";
      let group = groups.get(key);
      if (!group) {
        group = {
          patientId: inv.patientId,
          patientName: inv.patientName ?? "Walk-in / unassigned",
          patientPhone: inv.patientPhone ?? null,
          buckets: newBucketTotals(),
          invoiceCount: 0,
          overdueInvoiceCount: 0,
          oldestInvoiceDate: null,
        };
        groups.set(key, group);
      }

      addToBucket(group.buckets, daysOverdue, balance);
      addToBucket(grandTotals, daysOverdue, balance);
      group.invoiceCount += 1;

      const invoiceDate = dueDate.toISOString();
      if (!group.oldestInvoiceDate || invoiceDate < group.oldestInvoiceDate) {
        group.oldestInvoiceDate = invoiceDate;
      }
      if (daysOverdue > 0) {
        group.overdueInvoiceCount += 1;
        grandOverdueInvoices += 1;
      }
    }

    const rows = [...groups.values()]
      .map((g) => ({
        patientId: g.patientId,
        patientName: g.patientName,
        patientPhone: g.patientPhone,
        ...serializeBuckets(g.buckets),
        overdue: sumOverdue(g.buckets).toFixed(2),
        total: sumBuckets(g.buckets).toFixed(2),
        invoiceCount: g.invoiceCount,
        overdueInvoiceCount: g.overdueInvoiceCount,
        oldestInvoiceDate: g.oldestInvoiceDate,
      }))
      .sort((a, b) => Number(b.total) - Number(a.total));

    return {
      asOf: asOf.toISOString(),
      branchId: query.branchId ?? null,
      buckets: bucketBreakdown(grandTotals),
      totals: {
        ...serializeBuckets(grandTotals),
        overdue: sumOverdue(grandTotals).toFixed(2),
        total: sumBuckets(grandTotals).toFixed(2),
        patientCount: rows.length,
        overdueInvoiceCount: grandOverdueInvoices,
      },
      patients: rows,
    };
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
