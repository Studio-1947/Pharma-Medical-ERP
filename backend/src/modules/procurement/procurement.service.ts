import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { addDays } from "date-fns";
import Decimal from "decimal.js";
import { DrizzleService } from "../../database/drizzle.service";
import { ProcurementRepository } from "./procurement.repository";
import { calculateLine } from "./procurement.pricing";
import type {
  CreateSupplierDto,
  UpdateSupplierDto,
  QuerySupplierDto,
  CreatePurchaseOrderDto,
  ApprovePurchaseOrderDto,
  CreateGrnDto,
  QueryPurchaseOrderDto,
  CreateSupplierPaymentDto,
  QuerySupplierBillsDto,
  QuerySupplierLedgerDto,
  CreateSupplierReturnDto,
  ResolveReturnReplacementDto,
  ResolveReturnCreditNoteDto,
} from "@pharmerp/types";

@Injectable()
export class ProcurementService {
  constructor(
    private readonly repo: ProcurementRepository,
    private readonly drizzle: DrizzleService,
  ) {}

  // ─── Suppliers ───────────────────────────────────────────────────────────────

  findAllSuppliers(query: QuerySupplierDto) {
    return this.repo.findAllSuppliers(query);
  }

  async findSupplierById(id: string) {
    const supplier = await this.repo.findSupplierById(id);
    if (!supplier) throw new NotFoundException(`Supplier ${id} not found`);
    return { data: supplier };
  }

  async createSupplier(dto: CreateSupplierDto) {
    await this.assertSupplierCodeUnique(dto.code);
    try {
      const supplier = await this.repo.createSupplier(dto);
      return { data: supplier, message: "Supplier created" };
    } catch (e) {
      throw this.mapSupplierConflict(e, dto.code);
    }
  }

  async updateSupplier(id: string, dto: UpdateSupplierDto) {
    await this.findSupplierById(id);
    if (dto.code) await this.assertSupplierCodeUnique(dto.code, id);
    try {
      const supplier = await this.repo.updateSupplier(id, dto);
      return { data: supplier, message: "Supplier updated" };
    } catch (e) {
      throw this.mapSupplierConflict(e, dto.code);
    }
  }

  /** Supplier code is the human key used on POs — it must be unique. */
  private async assertSupplierCodeUnique(code: string, excludeId?: string) {
    const existing = await this.repo.findSupplierByCode(code, excludeId);
    if (existing) {
      throw new ConflictException(`Supplier code "${code}" is already used by "${existing.name}"`);
    }
  }

  /** Backstop for the check-then-insert race on the unique code index. */
  private mapSupplierConflict(e: unknown, code?: string): never {
    const err = e as { code?: string; cause?: { code?: string }; message?: string };
    if ((err?.code ?? err?.cause?.code) === "23505") {
      throw new ConflictException(`Supplier code "${code ?? ""}" is already used`);
    }
    throw e as Error;
  }

  async removeSupplier(id: string) {
    await this.findSupplierById(id);
    await this.repo.softDeleteSupplier(id);
    return { message: "Supplier deleted" };
  }

  // ─── Purchase Orders ──────────────────────────────────────────────────────────

  findAllPOs(query: QueryPurchaseOrderDto) {
    return this.repo.findAllPOs(query);
  }

  async findPOById(id: string) {
    const po = await this.repo.findPOById(id);
    if (!po) throw new NotFoundException(`Purchase order ${id} not found`);
    return { data: await this.withGrnBillTotals(po) };
  }

  /**
   * Each GRN is a delivery event (a batch arriving against the PO). This adds
   * a per-delivery bill summary — item count, total quantity, total amount —
   * so the frontend can render a receipt-style view without recomputing
   * unit cost * qty * tax across nested relations itself.
   */
  private async withGrnBillTotals(po: NonNullable<Awaited<ReturnType<ProcurementRepository["findPOById"]>>>) {
    const bills = await this.attachConsignmentDue((po.grns ?? []).map((grn) => this.computeGrnBill(grn)));
    return { ...po, grns: bills };
  }

  /**
   * A GRN is a delivery event — this is also the "bill" for that delivery.
   * Shared by the PO detail view and the supplier bills/ledger endpoints so
   * the qty * unitCost * (1 + tax) math only lives in one place.
   */
  private computeGrnBill(grn: any) {
    let totalAmount = new Decimal(0);
    let totalQty = 0;

    const items = (grn.items ?? []).map((item: any) => {
      const freeQty = item.freeQty ?? 0;
      const billedQty = Math.max(0, item.receivedQty - freeQty);
      const { lineTotal } = calculateLine({
        unitCost: item.poItem?.unitCost ?? "0",
        taxPct: item.poItem?.taxPct ?? "0",
        discountPct: item.poItem?.discountPct ?? "0",
        qty: billedQty,
      });
      totalAmount = totalAmount.plus(lineTotal);
      totalQty += item.receivedQty;

      return {
        ...item,
        medicineName: item.poItem?.medicine?.name ?? null,
        medicineSku: item.poItem?.medicine?.sku ?? null,
        unitCost: item.poItem?.unitCost ?? "0",
        taxPct: item.poItem?.taxPct ?? "0",
        discountPct: item.poItem?.discountPct ?? "0",
        schemeFreeQty: item.poItem?.schemeFreeQty ?? 0,
        isConsignment: item.poItem?.isConsignment ?? false,
        freeQty,
        billedQty,
        lineTotal: lineTotal.toFixed(2),
      };
    });

    return {
      ...grn,
      items,
      itemCount: items.length,
      totalQty,
      totalAmount: totalAmount.toFixed(2),
    };
  }

  /**
   * Consignment items are only payable once actually sold, unlike regular
   * items which are due in full on delivery. Non-consignment items keep
   * their full committed value as dueAmount; consignment items owe only for
   * units sold so far (net of returns), capped at what was billed.
   */
  private applyConsignmentDueAmounts(bill: any, soldQtyMap: Map<string, number>) {
    let amountDue = new Decimal(0);

    const items = bill.items.map((item: any) => {
      if (!item.isConsignment) {
        amountDue = amountDue.plus(item.lineTotal);
        return { ...item, dueAmount: item.lineTotal };
      }

      const netSold = Math.max(0, soldQtyMap.get(item.batchId) ?? 0);
      const soldQty = Math.min(netSold, item.billedQty);
      const { lineTotal: dueForSold } = calculateLine({
        unitCost: item.unitCost,
        taxPct: item.taxPct,
        discountPct: item.discountPct,
        qty: soldQty,
      });
      const capped = Decimal.min(dueForSold, new Decimal(item.lineTotal));
      amountDue = amountDue.plus(capped);
      return { ...item, soldQty, dueAmount: capped.toFixed(2) };
    });

    return { ...bill, items, amountDue: amountDue.toFixed(2) };
  }

  /** Batch-fetches sold quantities for every consignment batch across these bills in one query. */
  private async attachConsignmentDue(bills: any[]) {
    const consignmentBatchIds = bills.flatMap((b) =>
      b.items.filter((i: any) => i.isConsignment && i.batchId).map((i: any) => i.batchId as string),
    );

    const soldQtyMap = consignmentBatchIds.length
      ? await this.repo.getSoldQuantitiesForBatches(consignmentBatchIds)
      : new Map<string, number>();

    return bills.map((bill) => this.applyConsignmentDueAmounts(bill, soldQtyMap));
  }

  private async requireSupplier(id: string) {
    const supplier = await this.repo.findSupplierById(id);
    if (!supplier) throw new NotFoundException(`Supplier ${id} not found`);
    return supplier;
  }

  /**
   * Walks each delivery (bill) oldest-first, settling it from payments
   * directly linked to that GRN first, then drawing FIFO from the pool of
   * unlinked "on account" payments — same ordering principle as FEFO batch
   * selection elsewhere in this system, applied to money instead of stock.
   * Takes bills already run through attachConsignmentDue, so `amountDue`
   * (not the full committed `totalAmount`) is what's actually owed today.
   */
  private allocatePaymentsToBills(
    bills: Array<ReturnType<ProcurementService["computeGrnBill"]> & { amountDue: string }>,
    payments: Awaited<ReturnType<ProcurementRepository["getPaymentsForSupplier"]>>,
    creditDays: number,
  ) {
    const directByGrn = new Map<string, Decimal>();
    let onAccountAvailable = new Decimal(0);

    for (const p of payments) {
      const amt = new Decimal(p.amount);
      if (p.grnId) {
        directByGrn.set(p.grnId, (directByGrn.get(p.grnId) ?? new Decimal(0)).plus(amt));
      } else {
        onAccountAvailable = onAccountAvailable.plus(amt);
      }
    }

    return bills.map((bill: any) => {
      const billAmount = new Decimal(bill.amountDue);
      const direct = directByGrn.get(bill.id) ?? new Decimal(0);

      let paidAmount = Decimal.min(billAmount, direct);
      const remaining = billAmount.minus(paidAmount);
      if (remaining.greaterThan(0) && onAccountAvailable.greaterThan(0)) {
        const draw = Decimal.min(remaining, onAccountAvailable);
        paidAmount = paidAmount.plus(draw);
        onAccountAvailable = onAccountAvailable.minus(draw);
      }

      // Exact decimal math, so a settled bill lands on exactly zero — no
      // epsilon fudge needed to decide "paid".
      const balance = billAmount.minus(paidAmount);
      const status: "paid" | "partial" | "unpaid" =
        balance.lessThanOrEqualTo(0) ? "paid" : paidAmount.greaterThan(0) ? "partial" : "unpaid";

      return {
        grnId: bill.id,
        grnNumber: bill.grnNumber,
        poId: bill.poId,
        receivedAt: bill.receivedAt,
        dueDate: addDays(new Date(bill.receivedAt), creditDays).toISOString(),
        supplierInvoiceNo: bill.supplierInvoiceNo,
        items: bill.items,
        itemCount: bill.itemCount,
        totalQty: bill.totalQty,
        totalAmount: bill.totalAmount,
        amountDue: bill.amountDue,
        paidAmount: paidAmount.toFixed(2),
        balance: balance.toFixed(2),
        status,
      };
    });
  }

  /** Fetches + computes every bill for a supplier, oldest-first, with payments applied. */
  private async getAllocatedBills(supplierId: string) {
    const supplier = await this.requireSupplier(supplierId);
    const [grns, payments] = await Promise.all([
      this.repo.getGRNsForSupplier(supplierId),
      this.repo.getPaymentsForSupplier(supplierId),
    ]);

    const computed = await this.attachConsignmentDue(grns.map((grn) => this.computeGrnBill(grn)));
    const bills = this.allocatePaymentsToBills(computed, payments, supplier.creditDays);

    return { supplier, bills, payments };
  }

  async createPO(dto: CreatePurchaseOrderDto, raisedBy: string) {
    const po = await this.repo.createPO(dto, raisedBy);
    return { data: po, message: "Purchase order created" };
  }

  async approvePO(id: string, dto: ApprovePurchaseOrderDto, userId: string) {
    const existing = await this.repo.findPOById(id);
    if (!existing) throw new NotFoundException(`Purchase order ${id} not found`);

    if (!["pending_approval", "draft"].includes(existing.status)) {
      throw new UnprocessableEntityException(
        `Purchase order must be in draft or pending_approval status to approve. Current status: ${existing.status}`,
      );
    }

    if (!dto.approved) {
      const po = await this.repo.cancelPO(id);
      return { data: po, message: "Purchase order rejected and cancelled" };
    }

    const po = await this.repo.approvePO(id, userId);
    return { data: po, message: "Purchase order approved" };
  }

  async sendPO(id: string) {
    const existing = await this.repo.findPOById(id);
    if (!existing) throw new NotFoundException(`Purchase order ${id} not found`);

    if (!["approved", "draft"].includes(existing.status)) {
      throw new UnprocessableEntityException(
        `Purchase order cannot be sent in status: ${existing.status}`,
      );
    }

    const po = await this.repo.sendPO(id);
    return { data: po, message: "Purchase order sent to supplier" };
  }

  async cancelPO(id: string) {
    const existing = await this.repo.findPOById(id);
    if (!existing) throw new NotFoundException(`Purchase order ${id} not found`);

    if (["received", "cancelled"].includes(existing.status)) {
      throw new UnprocessableEntityException(
        `Purchase order cannot be cancelled in status: ${existing.status}`,
      );
    }

    const po = await this.repo.cancelPO(id);
    return { data: po, message: "Purchase order cancelled" };
  }

  async createGRN(poId: string, dto: CreateGrnDto, userId: string) {
    const existing = await this.repo.findPOById(poId);
    if (!existing) throw new NotFoundException(`Purchase order ${poId} not found`);

    if (!["approved", "sent", "partially_received"].includes(existing.status)) {
      throw new UnprocessableEntityException(
        `Cannot receive goods for purchase order in status: ${existing.status}`,
      );
    }

    const dtoWithPoId: CreateGrnDto = { ...dto, poId };

    const result = await this.drizzle.db.transaction(async (tx) => {
      const grnResult = await this.repo.createGRN(dtoWithPoId, userId, tx);

      // Determine new PO status
      const poItems = await this.repo.getPOItemsReceivingStatus(poId);
      const allFullyReceived = poItems.every((item) => item.receivedQty >= item.orderedQty);
      const newStatus = allFullyReceived ? "received" : "partially_received";
      await this.repo.updatePOStatus(poId, newStatus, tx);

      return grnResult;
    });

    return { data: result, message: "Goods received note created" };
  }

  // ─── Supplier bills & ledger ────────────────────────────────────────────────

  async listSupplierBills(supplierId: string, query: QuerySupplierBillsDto) {
    const { bills } = await this.getAllocatedBills(supplierId);

    // getAllocatedBills returns oldest-first (needed for FIFO settlement);
    // reverse for the newest-first list a bills screen expects.
    const ordered = [...bills].reverse();
    const filtered = query.status ? ordered.filter((b) => b.status === query.status) : ordered;

    const total = filtered.length;
    const start = (query.page - 1) * query.limit;
    const data = filtered.slice(start, start + query.limit);

    return {
      data,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async getSupplierBill(supplierId: string, grnId: string) {
    const { bills, payments } = await this.getAllocatedBills(supplierId);
    const bill = bills.find((b) => b.grnId === grnId);
    if (!bill) throw new NotFoundException(`Bill ${grnId} not found for this supplier`);

    const linkedPayments = payments
      .filter((p) => p.grnId === grnId)
      .map((p) => ({
        id: p.id,
        amount: p.amount,
        method: p.method,
        type: p.type,
        referenceNo: p.referenceNo,
        paidAt: p.paidAt,
      }));

    return { data: { ...bill, payments: linkedPayments } };
  }

  async getSupplierLedger(supplierId: string, query: QuerySupplierLedgerDto) {
    const { bills, payments } = await this.getAllocatedBills(supplierId);

    type Row = {
      date: Date;
      type: "bill" | "payment" | "credit_note";
      reference: string;
      debit: Decimal;
      credit: Decimal;
    };

    const billRows: Row[] = bills.map((bill) => ({
      date: new Date(bill.receivedAt),
      type: "bill",
      reference: bill.grnNumber,
      debit: new Decimal(bill.amountDue),
      credit: new Decimal(0),
    }));

    const consignmentPayable = bills
      .filter((b) => b.items.some((i: any) => i.isConsignment))
      .reduce((sum, b) => sum.plus(b.balance), new Decimal(0));

    const paymentRows: Row[] = payments.map((p) => ({
      date: new Date(p.paidAt),
      type: p.type === "credit_note" ? "credit_note" : "payment",
      reference:
        p.type === "credit_note"
          ? `Credit Note${p.referenceNo ? ` · ${p.referenceNo}` : ""}`
          : p.referenceNo
            ? `${(p.method ?? "").toUpperCase()} · ${p.referenceNo}`
            : (p.method ?? "").toUpperCase(),
      debit: new Decimal(0),
      credit: new Decimal(p.amount),
    }));

    const allRows = [...billRows, ...paymentRows].sort((a, b) => a.date.getTime() - b.date.getTime());

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
      supplierId,
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
      // Consignment liability isn't folded into supplier.outstandingBalance
      // (never incremented on receipt, only accrues as units sell) — shown
      // as a second figure so the two aren't silently conflated.
      consignmentPayable: consignmentPayable.toFixed(2),
    };
  }

  async recordSupplierPayment(supplierId: string, dto: CreateSupplierPaymentDto, paidBy: string) {
    await this.requireSupplier(supplierId);

    let skipBalanceUpdate = false;
    if (dto.grnId) {
      const owningSupplierId = await this.repo.getGRNSupplierId(dto.grnId);
      if (owningSupplierId !== supplierId) {
        throw new UnprocessableEntityException(
          `Bill ${dto.grnId} does not belong to supplier ${supplierId}`,
        );
      }
      // Purely-consignment bills were never added to outstandingBalance on
      // receipt, so settling them must not decrement it either.
      skipBalanceUpdate = await this.repo.isGRNPureConsignment(dto.grnId);
    }

    const payment = await this.drizzle.db.transaction((tx) =>
      this.repo.createSupplierPayment({ ...dto, supplierId, paidBy, type: "payment" }, tx, skipBalanceUpdate),
    );

    return { data: payment, message: "Payment recorded" };
  }

  // ─── Supplier returns (expiry/damage) ──────────────────────────────────────────

  async recordSupplierReturn(dto: CreateSupplierReturnDto, recordedBy: string) {
    const result = await this.drizzle.db.transaction((tx) =>
      this.repo.recordSupplierReturn(dto, recordedBy, tx),
    );
    if (!result) {
      throw new UnprocessableEntityException(
        `Cannot return ${dto.quantity} units — batch does not have that much stock available`,
      );
    }
    return { data: result, message: "Return recorded" };
  }

  private async requireReturn(id: string) {
    const ret = await this.repo.getReturnById(id);
    if (!ret) throw new NotFoundException(`Return ${id} not found`);
    if (ret.outcome !== "pending") {
      throw new UnprocessableEntityException(`Return ${id} is already resolved as ${ret.outcome}`);
    }
    return ret;
  }

  async resolveReturnAsReplacement(id: string, dto: ResolveReturnReplacementDto, resolvedBy: string) {
    await this.requireReturn(id);
    const updated = await this.drizzle.db.transaction((tx) =>
      this.repo.resolveReturnAsReplacement(id, dto, resolvedBy, tx),
    );
    return { data: updated, message: "Return resolved with replacement stock" };
  }

  async resolveReturnAsCreditNote(id: string, dto: ResolveReturnCreditNoteDto, paidBy: string) {
    const ret = await this.requireReturn(id);

    const supplierId = await this.repo.getSupplierIdForBatch(ret.batchId);
    if (!supplierId) {
      throw new UnprocessableEntityException(
        `Could not determine which supplier batch ${ret.batchId} was delivered by`,
      );
    }
    if (dto.grnId) {
      const owningSupplierId = await this.repo.getGRNSupplierId(dto.grnId);
      if (owningSupplierId !== supplierId) {
        throw new UnprocessableEntityException(`Bill ${dto.grnId} does not belong to this supplier`);
      }
    }

    const updated = await this.drizzle.db.transaction(async (tx) => {
      const payment = await this.repo.createSupplierPayment(
        {
          supplierId,
          grnId: dto.grnId,
          amount: dto.amount,
          notes: dto.notes,
          paidBy,
          type: "credit_note",
        },
        tx,
      );
      return this.repo.resolveReturnAsCreditNote(id, dto.amount, payment.id, tx);
    });

    return { data: updated, message: "Return resolved with a credit note" };
  }

  listSupplierReturns(supplierId: string) {
    return this.repo.listReturnsForSupplier(supplierId);
  }
}
