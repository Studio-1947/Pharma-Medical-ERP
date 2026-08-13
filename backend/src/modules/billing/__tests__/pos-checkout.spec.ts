import { describe, it, expect, vi, beforeEach } from "vitest";
import { BillingService } from "../billing.service";
import { UnprocessableEntityException } from "@nestjs/common";

/**
 * POS Checkout Flow tests — cover the full happy path and critical edge cases
 * in BillingService.create(). These are unit tests with mocked dependencies.
 *
 * Scenarios covered:
 *   CHECKOUT-01  OTC drug, single cash payment, no patient
 *   CHECKOUT-02  Multi-item, split payment → paymentMode = "mixed"
 *   CHECKOUT-03  Loyalty points accrual (1 point per ₹100)
 *   CHECKOUT-04  Loyalty points redemption (100 pts = ₹10 discount)
 *   CHECKOUT-05  Expired prescription rejected
 *   CHECKOUT-06  Already-fully-dispensed prescription item rejected
 *   CHECKOUT-07  Override approver must be pharmacist or admin
 *   CHECKOUT-08  Concurrent batch depletion guard (optimistic lock)
 *   CHECKOUT-09  PDF queue triggered after successful checkout
 *   CHECKOUT-10  ClickHouse events emitted fire-and-forget
 */

function buildService() {
  const mockRepo = {
    nextInvoiceNumber: vi.fn().mockResolvedValue("INV-20240115-0001"),
    createInvoiceWithItems: vi.fn().mockResolvedValue({
      invoice: { id: "inv-1", invoiceNo: "INV-20240115-0001" },
      items: [],
    }),
    findById: vi.fn(),
  };

  // Chainable mock TX builder — mimics Drizzle's fluent query interface
  const buildTx = (resultQueue: any[][] = []) => {
    const tx: any = {
      _queue: [...resultQueue],
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      returning: vi.fn(),
      values: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
    };

    // Each `.then()` call pops the next result from the queue
    let callIndex = 0;
    tx.then = (resolve: any) => {
      const result = tx._queue[callIndex++] ?? [];
      return Promise.resolve(result).then(resolve);
    };

    // returning() also pops the queue (used by UPDATE...RETURNING)
    tx.returning.mockImplementation(() => {
      const result = tx._queue[callIndex++] ?? [];
      return Promise.resolve(result);
    });

    return tx;
  };

  const mockBatchRepo = {
    selectBatchesForDispense: vi.fn(),
    selectBatchesForDispenseMulti: vi.fn(),
  };

  const mockMovementRepo = {
    log: vi.fn().mockResolvedValue(undefined),
    logMany: vi.fn().mockResolvedValue(undefined),
  };

  const mockTaxService = {
    calculateLineTax: vi.fn().mockReturnValue({
      lineTotal: 112,
      taxAmount: 12,
      breakdown: { cgst: 6, sgst: 6, igst: 0, taxableAmount: 100 },
    }),
    aggregateInvoiceTotals: vi.fn().mockReturnValue({
      subtotal: 100,
      taxAmount: 12,
      totalAmount: 112,
    }),
  };

  const mockPatientsRepo = {
    addLoyaltyPoints: vi.fn().mockResolvedValue(undefined),
    deductLoyaltyPoints: vi.fn().mockResolvedValue(undefined),
  };

  const mockS3 = { getPresignedUrl: vi.fn() };
  const mockClickHouse = { insertSaleEvents: vi.fn().mockResolvedValue(undefined) };
  const mockPdfService = { generateAndUpload: vi.fn().mockResolvedValue("invoices/INV-001.pdf") };

  const service = new BillingService(
    mockRepo as any,
    { db: null } as any, // replaced per-test below
    mockTaxService as any,
    mockBatchRepo as any,
    mockMovementRepo as any,
    mockPatientsRepo as any,
    mockS3 as any,
    mockClickHouse as any,
    mockPdfService as any,
  );

  return { service, mockRepo, mockBatchRepo, mockMovementRepo, mockTaxService, mockPatientsRepo, mockClickHouse, mockPdfService, buildTx };
}

// ─── CHECKOUT-01: OTC happy path ────────────────────────────────────────────

describe("CHECKOUT-01 — OTC drug, single cash payment, no patient", () => {
  it("creates invoice and decrements stock", async () => {
    const { service, mockRepo, mockBatchRepo, buildTx } = buildService();

    const dto = {
      items: [{ medicineId: "med-otc", quantity: 2, discountPct: "0" }],
      payments: [{ mode: "cash", amount: "112.00" }],
    };

    const tx = buildTx([
      [{ id: "med-otc", name: "Paracetamol", scheduleClass: "OTC", requiresPrescription: false, taxPercent: "12", stripSize: 10, isActive: true }], // medicines query
      [{ id: "batch-1" }], // UPDATE batch returning (stock deducted)
      // prescriptionItems update — skipped (no prescriptionId)
    ]);

    (service as any).drizzle = { db: { transaction: vi.fn((cb: any) => cb(tx)) } };

    mockBatchRepo.selectBatchesForDispenseMulti.mockResolvedValue([
      [{ batchId: "batch-1", batchNo: "B001", expiryDate: "2026-06-01", allocate: 2, mrpAtEntry: "560.00" }],
    ]);

    const result = await service.create(dto as any, "staff-1", "branch-1");

    expect(result.invoice.invoiceNo).toBe("INV-20240115-0001");
    expect(mockRepo.createInvoiceWithItems).toHaveBeenCalledOnce();
    // The selling branch is passed through to FEFO: a till may only allocate
    // packs on its own shelves, never another branch's stock.
    expect(mockBatchRepo.selectBatchesForDispenseMulti).toHaveBeenCalledWith(
      [{ medicineId: "med-otc", needed: 2 }],
      "branch-1",
      tx,
    );
  });

  it("allocates from the selling branch, not whichever branch holds older stock", async () => {
    // Regression guard. FEFO used to run unscoped, so a till at one branch was
    // allocated the company's oldest batch — decrementing another branch's
    // stock for a pack that was never physically in the building.
    const { service, mockBatchRepo, buildTx } = buildService();

    const dto = {
      items: [{ medicineId: "med-otc", quantity: 2, discountPct: "0" }],
      payments: [{ mode: "cash", amount: "112.00" }],
    };

    const tx = buildTx([
      [{ id: "med-otc", name: "Paracetamol", scheduleClass: "OTC", requiresPrescription: false, taxPercent: "12", stripSize: 10, isActive: true }],
      [{ id: "batch-b2" }],
    ]);
    (service as any).drizzle = { db: { transaction: vi.fn((cb: any) => cb(tx)) } };
    mockBatchRepo.selectBatchesForDispenseMulti.mockResolvedValue([
      [{ batchId: "batch-b2", batchNo: "B002", expiryDate: "2027-01-01", allocate: 2, mrpAtEntry: "560.00" }],
    ]);

    await service.create(dto as any, "staff-2", "branch-2");

    const [, passedBranchId] =
      mockBatchRepo.selectBatchesForDispenseMulti.mock.calls[0]!;
    expect(passedBranchId).toBe("branch-2");
    expect(passedBranchId).not.toBe("branch-1");
  });
});

// ─── CHECKOUT-02: Split payment → paymentMode = "mixed" ─────────────────────

describe("CHECKOUT-02 — Multi-item, split payment produces paymentMode=mixed", () => {
  it("sets paymentMode to mixed when two payment rows present", async () => {
    const { service, mockRepo, mockBatchRepo, mockTaxService, buildTx } = buildService();

    mockTaxService.aggregateInvoiceTotals.mockReturnValue({ subtotal: 200, taxAmount: 24, totalAmount: 224 });
    mockTaxService.calculateLineTax
      .mockReturnValueOnce({ lineTotal: 112, taxAmount: 12, breakdown: { cgst: 6, sgst: 6, igst: 0, taxableAmount: 100 } })
      .mockReturnValueOnce({ lineTotal: 112, taxAmount: 12, breakdown: { cgst: 6, sgst: 6, igst: 0, taxableAmount: 100 } });

    const dto = {
      items: [
        { medicineId: "med-a", quantity: 1, discountPct: "0" },
        { medicineId: "med-b", quantity: 1, discountPct: "0" },
      ],
      payments: [
        { mode: "cash", amount: "124.00" },
        { mode: "upi", amount: "100.00" },
      ],
    };

    const tx = buildTx([
      [
        { id: "med-a", name: "Med A", scheduleClass: "OTC", requiresPrescription: false, taxPercent: "12", stripSize: 10, isActive: true },
        { id: "med-b", name: "Med B", scheduleClass: "OTC", requiresPrescription: false, taxPercent: "12", stripSize: 10, isActive: true },
      ],
      [{ id: "batch-a" }],
      [{ id: "batch-b" }],
    ]);

    (service as any).drizzle = { db: { transaction: vi.fn((cb: any) => cb(tx)) } };
    mockBatchRepo.selectBatchesForDispenseMulti.mockResolvedValue([
      [{ batchId: "batch-a", batchNo: "BA01", expiryDate: "2026-06-01", allocate: 1, mrpAtEntry: "1120.00" }],
      [{ batchId: "batch-b", batchNo: "BB01", expiryDate: "2026-07-01", allocate: 1, mrpAtEntry: "1120.00" }],
    ]);

    await service.create(dto as any, "staff-1", "branch-1");

    const invoiceArg = mockRepo.createInvoiceWithItems.mock.calls[0]![0];
    expect(invoiceArg.paymentMode).toBe("mixed");
  });
});

// ─── CHECKOUT-03: Loyalty points accrual ────────────────────────────────────

describe("CHECKOUT-03 — Loyalty points accrual", () => {
  it("accrues 1 point per ₹100 of final total", async () => {
    const { service, mockBatchRepo, mockPatientsRepo, buildTx, mockTaxService } = buildService();

    mockTaxService.aggregateInvoiceTotals.mockReturnValue({ subtotal: 450, taxAmount: 50, totalAmount: 500 });

    const dto = {
      patientId: "patient-1",
      items: [{ medicineId: "med-otc", quantity: 5, discountPct: "0" }],
      payments: [{ mode: "cash", amount: "500.00" }],
    };

    const tx = buildTx([
      [{ id: "med-otc", name: "Vitamins", scheduleClass: "OTC", requiresPrescription: false, taxPercent: "12", stripSize: 10, isActive: true }],
      [{ id: "batch-1" }],
    ]);

    (service as any).drizzle = { db: { transaction: vi.fn((cb: any) => cb(tx)) } };
    mockBatchRepo.selectBatchesForDispenseMulti.mockResolvedValue([
      [{ batchId: "batch-1", batchNo: "B001", expiryDate: "2026-06-01", allocate: 5, mrpAtEntry: "1000.00" }],
    ]);

    await service.create(dto as any, "staff-1", "branch-1");

    expect(mockPatientsRepo.addLoyaltyPoints).toHaveBeenCalledWith("patient-1", 5, tx);
  });
});

// ─── CHECKOUT-04: Loyalty points redemption ─────────────────────────────────

describe("CHECKOUT-04 — Loyalty points redemption lowers final total", () => {
  it("applies ₹20 discount for 200 redeemed points", async () => {
    const { service, mockBatchRepo, mockPatientsRepo, buildTx, mockTaxService, mockRepo } = buildService();

    mockTaxService.aggregateInvoiceTotals.mockReturnValue({ subtotal: 200, taxAmount: 20, totalAmount: 220 });

    const dto = {
      patientId: "patient-1",
      loyaltyPointsToRedeem: 200, // ₹20 discount → finalTotal = 200
      items: [{ medicineId: "med-otc", quantity: 2, discountPct: "0" }],
      payments: [{ mode: "cash", amount: "200.00" }],
    };

    const tx = buildTx([
      [{ id: "med-otc", name: "Vitamins", scheduleClass: "OTC", requiresPrescription: false, taxPercent: "12", stripSize: 10, isActive: true }],
      [{ id: "batch-1" }],
    ]);

    (service as any).drizzle = { db: { transaction: vi.fn((cb: any) => cb(tx)) } };
    mockBatchRepo.selectBatchesForDispenseMulti.mockResolvedValue([
      [{ batchId: "batch-1", batchNo: "B001", expiryDate: "2026-06-01", allocate: 2, mrpAtEntry: "1100.00" }],
    ]);

    await service.create(dto as any, "staff-1", "branch-1");

    expect(mockPatientsRepo.deductLoyaltyPoints).toHaveBeenCalledWith("patient-1", 200, tx);
    const invoiceArg = mockRepo.createInvoiceWithItems.mock.calls[0]![0];
    expect(parseFloat(invoiceArg.discountAmount)).toBe(20);
    expect(parseFloat(invoiceArg.totalAmount)).toBe(200);
  });
});

// ─── CHECKOUT-05: Expired prescription rejected ──────────────────────────────

describe("CHECKOUT-05 — Expired prescription is rejected", () => {
  it("throws UnprocessableEntityException for expired prescription", async () => {
    const { service, buildTx } = buildService();

    const dto = {
      prescriptionId: "rx-expired",
      items: [{ medicineId: "med-h", quantity: 1 }],
      payments: [{ mode: "cash", amount: "112.00" }],
    };

    const tx = buildTx([
      [{ id: "med-h", name: "Tramadol", scheduleClass: "SCHEDULE_H", requiresPrescription: true, taxPercent: "12", stripSize: 10, isActive: true }],
      [{ status: "verified", expiryDate: "2020-01-01", id: "rx-expired" }], // expired
    ]);

    (service as any).drizzle = { db: { transaction: vi.fn((cb: any) => cb(tx)) } };

    await expect(service.create(dto as any, "staff-1", "branch-1")).rejects.toThrow(/expired/i);
  });
});

// ─── CHECKOUT-06: Fully-dispensed prescription item rejected ─────────────────

describe("CHECKOUT-06 — Already-fully-dispensed prescription item rejected", () => {
  it("throws when all units on the prescription have been dispensed", async () => {
    const { service, buildTx } = buildService();

    const dto = {
      prescriptionId: "rx-1",
      items: [{ medicineId: "med-h", quantity: 1 }],
      payments: [{ mode: "cash", amount: "112.00" }],
    };

    const tx = buildTx([
      [{ id: "med-h", name: "Tramadol", scheduleClass: "SCHEDULE_H", requiresPrescription: true, taxPercent: "12", stripSize: 10, isActive: true }],
      [{ status: "verified", expiryDate: "2099-01-01", id: "rx-1" }],
      [{ id: "rx-item-1", medicineId: "med-h", quantityPrescribed: 2, quantityDispensed: 2, isFullyDispensed: true }],
    ]);

    (service as any).drizzle = { db: { transaction: vi.fn((cb: any) => cb(tx)) } };

    await expect(service.create(dto as any, "staff-1", "branch-1")).rejects.toThrow(/fully dispensed/i);
  });
});

// ─── CHECKOUT-07: Override approver validation ───────────────────────────────

describe("CHECKOUT-07 — Schedule H override approver must be pharmacist or admin", () => {
  it("throws if override approver is a cashier", async () => {
    const { service, buildTx } = buildService();

    const dto = {
      overrideReason: "Emergency",
      overriddenBy: "user-cashier",
      items: [{ medicineId: "med-h", quantity: 1 }],
      payments: [{ mode: "cash", amount: "112.00" }],
    };

    const tx = buildTx([
      [{ id: "med-h", name: "Tramadol", scheduleClass: "SCHEDULE_H", requiresPrescription: true, taxPercent: "12", stripSize: 10, isActive: true }],
      [{ role: "cashier" }], // approver role query
    ]);

    (service as any).drizzle = { db: { transaction: vi.fn((cb: any) => cb(tx)) } };

    await expect(service.create(dto as any, "staff-1", "branch-1")).rejects.toThrow(/Override approver/i);
  });
});

// ─── CHECKOUT-08: Concurrent batch depletion guard ───────────────────────────

describe("CHECKOUT-08 — Concurrent batch depletion guard", () => {
  it("throws UnprocessableEntityException when optimistic lock fails (no rows returned from UPDATE)", async () => {
    const { service, mockBatchRepo, mockTaxService, buildTx } = buildService();

    const dto = {
      items: [{ medicineId: "med-otc", quantity: 2, discountPct: "0" }],
      payments: [{ mode: "cash", amount: "112.00" }],
    };

    // UPDATE batch returning [] = concurrent depletion
    const tx = buildTx([
      [{ id: "med-otc", name: "Paracetamol", scheduleClass: "OTC", requiresPrescription: false, taxPercent: "12", stripSize: 10, isActive: true }],
      [], // UPDATE batch RETURNING [] — optimistic lock fails
    ]);

    (service as any).drizzle = { db: { transaction: vi.fn((cb: any) => cb(tx)) } };
    mockBatchRepo.selectBatchesForDispenseMulti.mockResolvedValue([
      [{ batchId: "batch-1", batchNo: "B001", expiryDate: "2026-06-01", allocate: 2, mrpAtEntry: "560.00" }],
    ]);

    await expect(service.create(dto as any, "staff-1", "branch-1")).rejects.toThrow(/Concurrent depletion/i);
  });
});

// ─── CHECKOUT-09: PDF generated on-demand ────────────────────────────────────

describe("CHECKOUT-09 — PDF is not pre-generated during checkout", () => {
  it("does not call pdfService during checkout — PDF is generated on first /pdf request", async () => {
    const { service, mockBatchRepo, mockPdfService, buildTx } = buildService();

    const dto = {
      items: [{ medicineId: "med-otc", quantity: 1, discountPct: "0" }],
      payments: [{ mode: "cash", amount: "112.00" }],
    };

    const tx = buildTx([
      [{ id: "med-otc", name: "Paracetamol", scheduleClass: "OTC", requiresPrescription: false, taxPercent: "12", stripSize: 10, isActive: true }],
      [{ id: "batch-1" }],
    ]);

    (service as any).drizzle = { db: { transaction: vi.fn((cb: any) => cb(tx)) } };
    mockBatchRepo.selectBatchesForDispenseMulti.mockResolvedValue([
      [{ batchId: "batch-1", batchNo: "B001", expiryDate: "2026-06-01", allocate: 1, mrpAtEntry: "1120.00" }],
    ]);

    await service.create(dto as any, "staff-1", "branch-1");

    expect(mockPdfService.generateAndUpload).not.toHaveBeenCalled();
  });
});

// ─── CHECKOUT-11: Doctor consultation fee line ───────────────────────────────

describe("CHECKOUT-11 — Doctor consultation fee billed as GST-exempt line", () => {
  it("adds the fee to subtotal/total and writes a consultation line with no stock", async () => {
    const { service, mockRepo, mockBatchRepo, mockMovementRepo, buildTx } = buildService();

    const dto = {
      consultationFee: { doctorName: "Dr. Anjali Chettri", amount: "400.00" },
      items: [{ medicineId: "med-otc", quantity: 2, discountPct: "0" }],
      // 112 (medicines) + 400 (fee) = 512
      payments: [{ mode: "cash", amount: "512.00" }],
    };

    const tx = buildTx([
      [{ id: "med-otc", name: "Paracetamol", scheduleClass: "OTC", requiresPrescription: false, taxPercent: "12", stripSize: 10, isActive: true }], // medicines query
      [{ id: "batch-1" }], // UPDATE batch returning (stock deducted)
    ]);
    (service as any).drizzle = { db: { transaction: vi.fn((cb: any) => cb(tx)) } };
    mockBatchRepo.selectBatchesForDispenseMulti.mockResolvedValue([
      [{ batchId: "batch-1", batchNo: "B001", expiryDate: "2026-06-01", allocate: 2, mrpAtEntry: "560.00" }],
    ]);

    await service.create(dto as any, "staff-1", "branch-1");

    const [invoiceArg, itemsArg] = mockRepo.createInvoiceWithItems.mock.calls[0]!;
    expect(parseFloat(invoiceArg.subtotal)).toBe(500); // 100 + 400
    expect(parseFloat(invoiceArg.taxAmount)).toBe(12);  // fee carries no tax
    expect(parseFloat(invoiceArg.totalAmount)).toBe(512);

    const feeLine = itemsArg.find((i: any) => i.itemType === "consultation");
    expect(feeLine).toBeDefined();
    expect(feeLine.itemName).toContain("Dr. Anjali Chettri");
    expect(feeLine.medicineId).toBeNull();
    expect(feeLine.batchId).toBeNull();
    expect(feeLine.unitPrice).toBe("400.00");
    expect(feeLine.taxPct).toBe("0");

    // Fee is a service line: FEFO allocates only for the medicine and the
    // stock movement ledger records only the medicine deduction.
    expect(mockBatchRepo.selectBatchesForDispenseMulti).toHaveBeenCalledTimes(1);
    expect(mockMovementRepo.logMany.mock.calls[0]![0]).toHaveLength(1);
    expect(mockMovementRepo.logMany.mock.calls[0]![0][0].batchId).toBe("batch-1");
  });

  it("rejects a payment that omits the consultation fee", async () => {
    const { service, mockBatchRepo, buildTx } = buildService();

    const dto = {
      consultationFee: { doctorName: "Dr. X", amount: "400.00" },
      items: [{ medicineId: "med-otc", quantity: 2, discountPct: "0" }],
      payments: [{ mode: "cash", amount: "112.00" }], // fee not included
    };

    const tx = buildTx([
      [{ id: "med-otc", name: "Paracetamol", scheduleClass: "OTC", requiresPrescription: false, taxPercent: "12", stripSize: 10, isActive: true }],
    ]);
    (service as any).drizzle = { db: { transaction: vi.fn((cb: any) => cb(tx)) } };
    mockBatchRepo.selectBatchesForDispenseMulti.mockResolvedValue([
      [{ batchId: "batch-1", batchNo: "B001", expiryDate: "2026-06-01", allocate: 2, mrpAtEntry: "560.00" }],
    ]);

    await expect(service.create(dto as any, "staff-1", "branch-1")).rejects.toThrow(/does not match/i);
  });
});

// ─── CHECKOUT-10: ClickHouse events emitted ──────────────────────────────────

describe("CHECKOUT-10 — ClickHouse sale events emitted after checkout", () => {
  it("calls insertSaleEvents with one event per line allocation", async () => {
    const { service, mockBatchRepo, mockClickHouse, buildTx } = buildService();

    const dto = {
      items: [{ medicineId: "med-otc", quantity: 2, discountPct: "0" }],
      payments: [{ mode: "cash", amount: "112.00" }],
    };

    const tx = buildTx([
      [{ id: "med-otc", name: "Paracetamol", scheduleClass: "OTC", requiresPrescription: false, taxPercent: "12", stripSize: 10, isActive: true }],
      [{ id: "batch-1" }],
    ]);

    (service as any).drizzle = { db: { transaction: vi.fn((cb: any) => cb(tx)) } };
    mockBatchRepo.selectBatchesForDispenseMulti.mockResolvedValue([
      [{ batchId: "batch-1", batchNo: "B001", expiryDate: "2026-06-01", allocate: 2, mrpAtEntry: "560.00" }],
    ]);

    await service.create(dto as any, "staff-1", "branch-1");

    // insertSaleEvents is fire-and-forget — use a small wait to let the microtask flush
    await Promise.resolve();
    expect(mockClickHouse.insertSaleEvents).toHaveBeenCalledOnce();
    const events = mockClickHouse.insertSaleEvents.mock.calls[0]![0];
    expect(events).toHaveLength(1);
    expect(events[0].medicineId).toBe("med-otc");
    expect(events[0].quantity).toBe(2);
  });
});
