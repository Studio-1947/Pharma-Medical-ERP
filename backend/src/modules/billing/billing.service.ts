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
  RETURNABLE_INVOICE_STATUSES,
  isReturnableStatus,
} from "../../common/utils/invoice-status";
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
  AttachPrescriptionDto,
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

/**
 * Postgres 23505 — unique_violation. Reached when two replays of the same
 * offline sale race past the clientRef lookup and the index settles it.
 */
function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string; cause?: { code?: string } })?.code
    ?? (err as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

interface AllocationLine extends BatchAllocation {
  item: InvoiceItemDto;
  med: MedicineSnapshot;
  lineTotal: number;
  taxAmount: number;
  breakdown: TaxBreakdown;
  taxableAmount: number;
}

/**
 * Schedule H / H1 / X — the classes that may not leave the counter without a
 * verified prescription.
 *
 * Accepts both spellings on purpose. The seed writes "SCHEDULE_H"; the real
 * imported catalogue writes "H" (3,911 rows on the live database, plus 222 H1
 * and 5 X). Matching only the seed's spelling made this check dead code
 * against production data — the Rx gate held solely because every one of those
 * rows also carries requires_prescription = true, which is one bad import away
 * from letting a Schedule H sale through.
 */
export function isControlledSchedule(scheduleClass: string | null | undefined): boolean {
  if (!scheduleClass) return false;
  const normalised = scheduleClass.trim().toUpperCase().replace(/^SCHEDULE[_\s-]?/, "");
  return normalised === "H" || normalised === "H1" || normalised === "X";
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
    // A replayed checkout must not become a second sale. The offline queue
    // marks a row synced only once the POST resolves, so a response lost after
    // the server committed — dropped connection, timeout, tab closed — sent the
    // identical payload again on the next reconnect, billing the patient twice,
    // deducting the stock twice and accruing the points twice.
    if (dto.clientRef) {
      const already = await this.repo.findByClientRef(dto.clientRef);
      if (already) return this.buildCreateResponse(already);
    }

    let result;
    try {
      result = await this.createInTransaction(dto, staffId, branchId);
    } catch (err) {
      // Two replays can pass the check above at the same moment; the unique
      // index is what actually decides. Losing that race is success, not an
      // error — the sale is recorded, just not by this request.
      if (dto.clientRef && isUniqueViolation(err)) {
        const winner = await this.repo.findByClientRef(dto.clientRef);
        if (winner) return this.buildCreateResponse(winner);
      }
      throw err;
    }

    return result;
  }

  /** Re-serves an invoice that a previous, duplicate attempt already wrote. */
  private async buildCreateResponse(invoice: any) {
    const tokenNo = await this.repo.findTokenNoByPrescription(invoice.prescriptionId);
    return {
      invoice: { ...invoice, tokenNo },
      items: invoice.items ?? [],
      // Lets the POS tell "your sale is recorded" apart from "a new sale was
      // just made", which matters when reprinting after a flaky connection.
      deduplicated: true,
    };
  }

  private async createInTransaction(dto: CreateInvoiceDto, staffId: string, branchId: string) {
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

      if (dto.rxPending) {
        const anyControlled = dto.items.some((item) => {
          const med = medicines.find((m) => m.id === item.medicineId);
          return !!med && (isControlledSchedule(med.scheduleClass) || med.requiresPrescription);
        });
        if (!anyControlled) {
          throw new UnprocessableEntityException(
            "Nothing on this bill needs a prescription, so there is none to attach later",
          );
        }
      }

      for (const item of dto.items) {
        const med = medicines.find(m => m.id === item.medicineId);
        if (!med || !med.isActive) {
          throw new NotFoundException(
            "One of the items on this bill is no longer available — it may have been removed or deactivated. Clear the bill and add it again.",
          );
        }

        const isControlled = isControlledSchedule(med.scheduleClass) || med.requiresPrescription;

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

      // A doctor tag is an attribution, so the id has to name a doctor. The FK
      // alone would happily accept any user — the cashier's own id included —
      // and the per-doctor figures would then be quietly wrong rather than
      // rejected at the counter.
      if (dto.referredByDoctorId) {
        const [doctor] = await tx
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(
            and(
              eq(schema.users.id, dto.referredByDoctorId),
              eq(schema.users.role, "doctor"),
              eq(schema.users.isActive, true),
            ),
          )
          .limit(1);
        if (!doctor) {
          throw new UnprocessableEntityException(
            "The doctor this sale was tagged to is not an active doctor at this practice",
          );
        }
      }

      // 2. FEFO Batch Selection — one query for every line item instead of
      // one query per item.
      const allAllocations: RawAllocation[] = [];
      const batchAllocationsPerItem = await this.batchRepo.selectBatchesForDispenseMulti(
        dto.items.map(item => ({
          medicineId: item.medicineId,
          needed: item.quantity,
          // So an out-of-stock failure can name the product on the counter
          // screen rather than printing its id.
          medicineName: medicines.find(m => m.id === item.medicineId)?.name,
        })),
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
        // Pre-tax unit price, despite the column name — see the note on
        // TaxService.calculateLineTax. GST is added on top, deliberately.
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
      // Pre-discount total. Kept for reference only — the charged total is
      // computed from the discounted lines further down.
      const totalWithFee = new Decimal(totalAmount).plus(feeAmount).toNumber();
      void totalWithFee;

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

      // A price reduction agreed at the time of supply. GST is charged on what
      // the patient actually pays, so this has to come off the taxable value
      // BEFORE the tax is worked out. It previously came off the total after
      // the tax had already been computed, which charged GST on money never
      // collected and overstated the liability on every discounted sale.
      const manualDiscount = new Decimal(dto.discountAmount ?? "0");

      if (manualDiscount.greaterThan(0)) {
        const adjusted = this.taxService.apportionDiscountAcrossLines(
          lines.map((l) => ({
            taxableAmount: l.taxableAmount,
            taxPct: parseFloat(l.med.taxPercent),
          })),
          manualDiscount.toNumber(),
          interState,
        );
        adjusted.forEach((a, i) => {
          const line = lines[i]!;
          line.taxableAmount = a.taxableAmount;
          line.taxAmount = a.taxAmount;
          line.lineTotal = a.lineTotal;
          line.breakdown = a.breakdown;
        });
      }

      // Redeemed loyalty points are deliberately NOT apportioned. They are
      // consideration the patient hands over, not a reduction in the price of
      // the goods, so the taxable value is unchanged and only the cash due
      // falls. Treating them as a price reduction would also put the server's
      // total below what the POS quoted, and the over-payment guard below would
      // then reject every checkout that redeemed points.
      const discountAmount = manualDiscount.plus(loyaltyDiscount);

      // Recomputed from the adjusted lines so the stored tax, and the per-line
      // CGST/SGST that GSTR-1 is built from, agree with each other.
      const discountedTax = lines
        .reduce((sum, l) => sum.plus(l.taxAmount), new Decimal(0))
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

      // subtotal − discount + tax, holding the same identity the printed bill
      // shows. With no manual discount this is exactly the old total, so the
      // amount the POS quoted still matches.
      const finalTotal = new Decimal(subtotalWithFee)
        .minus(discountAmount)
        .plus(discountedTax)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
        .toNumber();

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
        referenceId?: string;
      }[] = [];

      for (const { allocation, item, med } of allAllocations) {
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
            `${med.name} was sold at another till while this bill was open, so batch ${allocation.batchNo} no longer has enough units. Check the stock and try again.`
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

      // Written after the invoice below, not here: a sale movement recorded
      // referenceType "invoice" with a null referenceId, so the ledger said a
      // sale had happened without saying which sale. Void and return had always
      // stamped theirs. That is the link a recall, a billing dispute or a
      // Schedule H trace follows — "which invoice took this batch off the
      // shelf" was unanswerable from the movement alone.

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
      // Allocated after the stock work, never before it. The sequence row is the
      // only thing that serialises checkouts within a branch, so it is held for
      // the shortest possible slice of the transaction; and taking it after the
      // batch locks (FEFO selects FOR UPDATE) fixes one global lock order —
      // batches, then sequence — which is what stops a concurrent sale and
      // return from deadlocking against each other. createReturn() follows the
      // same order for the same reason.
      const invoiceNo = await this.repo.nextInvoiceNumber(branchId, tx);

      // Computed here rather than at the accrual step below so the figure can
      // be stored on the invoice. A void has to give back exactly what the sale
      // took and gave, and neither number is recoverable from the row otherwise.
      const pointsEarned =
        dto.patientId && finalTotal > 0 ? Math.floor(finalTotal / 100) : 0;

      const invoiceData: typeof schema.salesInvoices.$inferInsert = {
        invoiceNo,
        patientId: dto.patientId,
        staffId,
        branchId,
        prescriptionId: dto.prescriptionId,
        referredByDoctorId: dto.referredByDoctorId ?? null,
        subtotal: subtotalWithFee.toFixed(2),
        discountAmount: discountAmount.toFixed(2),
        taxAmount: discountedTax.toFixed(2),
        totalAmount: finalTotalDec.toFixed(2),
        amountPaid: paymentTotalDec.toFixed(2),
        amountDue: amountDueDec.toFixed(2),
        paymentMode: dto.payments.length > 1 ? "mixed" : dto.payments[0]!.mode as any,
        status: invoiceStatus,
        loyaltyPointsEarned: pointsEarned,
        loyaltyPointsRedeemed: pointsToRedeem,
        notes: dto.notes,
        isOfflineSync: dto.isOfflineSync ?? false,
        clientRef: dto.clientRef,
        isReturn: false,
        overrideReason: dto.overrideReason,
        overriddenBy: dto.overriddenBy,
        rxPending: dto.rxPending ?? false,
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

      // Same transaction as the batch deductions above, so the ledger and the
      // stock can never disagree about whether the sale happened.
      await this.movementRepo.logMany(
        movementRows.map((row) => ({ ...row, referenceId: invoice.id })),
        tx,
      );

      // Insert multiple payment rows
      for (const p of dto.payments) {
        // A sale handed over entirely on credit still has to declare how it was
        // settled — the counter sends one `credit` entry of zero so the invoice
        // carries paymentMode "credit" — but no money moved, so there is nothing
        // to record in the payments ledger. A zero row here would show on the
        // bill as a ₹0.00 receipt and count as a collection that never happened.
        if (new Decimal(p.amount).lte(0)) continue;
        await tx.insert(schema.payments).values({
          invoiceId: invoice.id,
          amount: p.amount,
          mode: p.mode as any,
          referenceNo: p.referenceNo,
          processedBy: staffId,
        });
      }

      // 6. Accrue loyalty points (1 point per ₹100 of final total, rounded down)
      if (dto.patientId && pointsEarned > 0) {
        await this.patientsRepo.addLoyaltyPoints(dto.patientId, pointsEarned, tx);
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

  /**
   * Undoes everything a sale did apart from moving stock.
   *
   * create() writes four things beyond the batch quantities: it accrues loyalty
   * points, spends redeemed ones, books any unpaid balance to the patient, and
   * marks prescription lines as dispensed. The void path reversed none of them,
   * so a cancelled sale left the patient holding points they had not earned,
   * short of points they had spent, owing money for goods they never kept, and
   * — worst of the four — with a prescription reading as fully dispensed, which
   * the Schedule H gate then refuses to dispense against a second time.
   *
   * Runs inside the caller's transaction, after the conditional status update
   * has claimed the void, so a concurrent second void cannot double-reverse.
   */
  private async reverseNonStockEffects(
    invoice: {
      patientId?: string | null;
      prescriptionId?: string | null;
      amountDue?: string | null;
      loyaltyPointsEarned?: number | null;
      loyaltyPointsRedeemed?: number | null;
      items?: Array<{ medicineId?: string | null; quantity: number }>;
    },
    tx: any,
  ) {
    if (invoice.patientId) {
      // Take back what the sale awarded. Zero on invoices written before the
      // column existed, which reverse nothing rather than guess.
      const earned = invoice.loyaltyPointsEarned ?? 0;
      if (earned > 0) {
        // Clawback, not a strict deduction: if the patient already spent these
        // points, refusing here would abort the void and leave the sale standing.
        await this.patientsRepo.clawBackLoyaltyPoints(invoice.patientId, earned, tx);
      }

      // Give back what the patient spent on a sale that no longer stands.
      const redeemed = invoice.loyaltyPointsRedeemed ?? 0;
      if (redeemed > 0) {
        await this.patientsRepo.addLoyaltyPoints(invoice.patientId, redeemed, tx);
      }

      // A voided credit sale is not a debt.
      const due = new Decimal(invoice.amountDue ?? "0");
      if (due.greaterThan(0)) {
        await this.patientsRepo.deductOutstanding(
          invoice.patientId,
          due.toFixed(2),
          tx,
        );
      }
    }

    if (!invoice.prescriptionId) return;

    // Hand the prescribed quantities back. Two cart lines can name the same
    // medicine, so the deltas are summed before being applied — subtracting
    // per line would leave the second line's quantity standing.
    const dispensedByMedicine = new Map<string, number>();
    for (const item of invoice.items ?? []) {
      if (!item.medicineId) continue;
      dispensedByMedicine.set(
        item.medicineId,
        (dispensedByMedicine.get(item.medicineId) ?? 0) + item.quantity,
      );
    }
    if (dispensedByMedicine.size === 0) return;

    for (const [medicineId, quantity] of dispensedByMedicine) {
      await tx
        .update(schema.prescriptionItems)
        .set({
          // GREATEST guards the case where the line was also dispensed on
          // another invoice: never drive the counter below zero.
          quantityDispensed: sql`GREATEST(${schema.prescriptionItems.quantityDispensed} - ${quantity}, 0)`,
          // Recomputed rather than forced to false: another invoice may have
          // dispensed the rest of this line, and blanking the flag would reopen
          // a prescription that is genuinely spent.
          isFullyDispensed: sql`(
            ${schema.prescriptionItems.quantityPrescribed} IS NOT NULL
            AND GREATEST(${schema.prescriptionItems.quantityDispensed} - ${quantity}, 0)
                >= ${schema.prescriptionItems.quantityPrescribed}
          )`,
        })
        .where(
          and(
            eq(schema.prescriptionItems.prescriptionId, invoice.prescriptionId),
            eq(schema.prescriptionItems.medicineId, medicineId),
          ),
        );
    }
  }


  /**
   * Attaches the prescription a manager promised at the counter.
   *
   * Documentary only, and deliberately so: the stock left the shelf when the
   * invoice was written, the money is taken, and the sale is already in the
   * ledger. What was missing is the piece of paper that authorised it, so this
   * records which prescription that was and clears the outstanding flag. It
   * does NOT touch stock, totals, or the prescription's dispensed quantities —
   * re-running the dispense accounting hours later against a prescription
   * whose lines may not even match the bill would corrupt both.
   */
  async attachPrescription(
    id: string,
    dto: AttachPrescriptionDto,
    user: { sub: string; role?: string; branchId?: string | null },
  ) {
    const invoice = (await this.repo.findById(id)) as any;
    if (!invoice) throw new NotFoundException(`Invoice ${id} not found`);

    if (invoice.prescriptionId) {
      throw new UnprocessableEntityException(
        "This bill already has a prescription linked to it",
      );
    }

    const [rx] = await this.drizzle.db
      .select({
        id: schema.prescriptions.id,
        status: schema.prescriptions.status,
        branchId: schema.prescriptions.branchId,
        deletedAt: schema.prescriptions.deletedAt,
      })
      .from(schema.prescriptions)
      .where(eq(schema.prescriptions.id, dto.prescriptionId));

    if (!rx || rx.deletedAt) {
      throw new NotFoundException("That prescription no longer exists");
    }
    // An unverified prescription does not discharge the debt — it just moves
    // the gap from "no paper" to "paper nobody has checked".
    if (rx.status !== "verified") {
      throw new UnprocessableEntityException(
        "Verify the prescription first — an unverified one does not close off a Schedule H sale",
      );
    }
    // A prescription filed at another branch cannot be the authority for this
    // branch's dispense; branch is how these registers are kept and inspected.
    if (rx.branchId && invoice.branchId && rx.branchId !== invoice.branchId) {
      throw new UnprocessableEntityException(
        "That prescription belongs to another branch",
      );
    }

    await this.drizzle.db
      .update(schema.salesInvoices)
      .set({ prescriptionId: dto.prescriptionId, rxPending: false })
      .where(eq(schema.salesInvoices.id, id));

    await this.audit?.writeSafe({
      actorId: user.sub,
      action: AuditAction.INVOICE_RX_ATTACH,
      entity: "sales_invoice",
      entityId: id,
      oldValue: { prescriptionId: null, rxPending: invoice.rxPending ?? true },
      newValue: { prescriptionId: dto.prescriptionId, rxPending: false },
    });

    return {
      data: { id, prescriptionId: dto.prescriptionId, rxPending: false },
      message: "Prescription attached — this sale is no longer outstanding",
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

      // Everything below used to survive a void, because only the stock was
      // being put back. A voided sale that still awards points, still bills the
      // patient and still counts against their prescription is not voided in
      // any sense the counter would recognise.
      await this.reverseNonStockEffects(existing.data, tx);
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
    // Previously gated on status === "confirmed", which no sale has carried
    // since the checkout rewrite — create() writes "paid" or "partially_paid"
    // and recordPayment() moves a settled credit sale to "paid". The gate
    // therefore rejected every invoice the POS could produce, so returns were
    // unreachable in practice. "confirmed" stays in the list for historic rows.
    if (!isReturnableStatus(original.status)) {
      throw new UnprocessableEntityException(
        `Invoice ${original.invoiceNo} cannot be returned — status is "${original.status}". ` +
          `Returns are accepted on: ${RETURNABLE_INVOICE_STATUSES.join(", ")}.`,
      );
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

    // Split the credit between "cancel what they still owe" and "hand money
    // back". Now that credit sales are returnable, paying out the full line
    // value in cash would refund money the patient never paid and leave the
    // original invoice's due standing — the patient would be paid for goods
    // they returned and still be billed for them.
    const creditValue = new Decimal(returnTotal).abs();
    const originalDue = new Decimal(original.amountDue ?? "0");
    const creditAgainstDue = Decimal.min(creditValue, originalDue);
    const cashRefund = creditValue.minus(creditAgainstDue);

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

      // Allocated here, not at the top of the transaction, for two reasons.
      //
      // Lock ORDER: create() takes the batch locks first (FEFO selects FOR
      // UPDATE) and the sequence row second. A return that took them the other
      // way round would deadlock against a concurrent sale on the same branch —
      // each holding what the other is waiting for — and Postgres would kill
      // one of them mid-checkout. Every write path now takes batches, then the
      // sequence, in that order.
      //
      // Lock DURATION: the sequence row is the one thing that serialises
      // checkouts within a branch, so it is held for as little of the
      // transaction as possible — everything slow (restocking, movement logs)
      // has already finished by this point.
      const returnInvoiceNo = await this.repo.nextInvoiceNumber(original.branchId, tx);

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
        // What actually went back across the counter. On a fully-settled
        // invoice this equals totalAmount; on a credit sale the rest of the
        // credit is applied to the original's due below instead of paid out.
        amountPaid: cashRefund.negated().toFixed(2),
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

      // Refund payment row (negative amount). Only for money that genuinely
      // left the till — a return that merely cancels an unpaid balance moves no
      // cash, and a zero-value payment row would misreport the day's takings.
      if (cashRefund.greaterThan(0)) {
        await tx.insert(schema.payments).values({
          invoiceId: returnInvoice.id,
          amount: cashRefund.negated().toFixed(2),   // negative string e.g. "-150.00"
          mode: refundMode as any,
          processedBy: staffId,
        });
      }

      // Write down the original invoice's outstanding balance by the part of
      // the credit that was not refunded in cash, and mirror it on the
      // patient's account so the two cannot drift.
      if (creditAgainstDue.greaterThan(0)) {
        const remainingDue = originalDue.minus(creditAgainstDue);
        await tx
          .update(schema.salesInvoices)
          .set({
            amountDue: remainingDue.toFixed(2),
            // A credit sale whose balance is fully cancelled by a return is
            // settled, not still awaiting payment.
            ...(remainingDue.equals(0) && original.status === "partially_paid"
              ? { status: "paid" as const }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(schema.salesInvoices.id, originalInvoiceId));

        if (original.patientId) {
          await this.patientsRepo.deductOutstanding(
            original.patientId,
            creditAgainstDue.toFixed(2),
            tx,
          );
        }
      }

      return {
        data: {
          invoice: returnInvoice,
          items: returnInsertedItems,
          creditAgainstDue: creditAgainstDue.toFixed(2),
          cashRefund: cashRefund.toFixed(2),
        },
        message: cashRefund.greaterThan(0)
          ? `Return processed — ₹${cashRefund.toFixed(2)} refunded`
          : `Return processed — ₹${creditAgainstDue.toFixed(2)} written off against the outstanding balance`,
      };
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
