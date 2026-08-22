import { describe, it, expect, vi } from "vitest";
import { BillingService } from "../billing.service";
import { UnprocessableEntityException } from "@nestjs/common";

/**
 * Counter credit sales — medicines handed over now, money collected later —
 * and the doctor a counter sale is credited to.
 *
 * The credit path reuses the existing under-payment rule rather than inventing
 * a second one: the bill is issued in full, whatever is not tendered becomes
 * the patient's outstanding balance. What is guarded here is the part that is
 * easy to get wrong and expensive when it is:
 *
 *  - a fully-unpaid sale writes no ₹0 payment row, which would otherwise read
 *    on the bill as a receipt and in the day-book as a collection that never
 *    happened, while still stamping the invoice as a credit sale;
 *  - the debt lands on the patient's account, because an invoice that owes
 *    money nobody is tracking is just a hole in the till;
 *  - a walk-in still cannot owe anything;
 *  - a doctor tag has to name an actual doctor, or per-doctor figures are
 *    quietly wrong instead of loudly rejected.
 */

function buildService() {
  const mockRepo = {
    nextInvoiceNumber: vi.fn().mockResolvedValue("BRN01-0001"),
    findTokenNoByPrescription: vi.fn().mockResolvedValue(null),
    createInvoiceWithItems: vi.fn().mockResolvedValue({
      invoice: { id: "inv-1", invoiceNo: "BRN01-0001" },
      items: [],
    }),
    findById: vi.fn(),
  };

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
    let callIndex = 0;
    tx.then = (resolve: any) => {
      const result = tx._queue[callIndex++] ?? [];
      return Promise.resolve(result).then(resolve);
    };
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
    apportionDiscountAcrossLines: vi.fn().mockReturnValue([]),
    aggregateInvoiceTotals: vi.fn().mockReturnValue({
      subtotal: 100,
      taxAmount: 12,
      totalAmount: 112,
    }),
  };
  const mockPatientsRepo = {
    addLoyaltyPoints: vi.fn().mockResolvedValue(undefined),
    deductLoyaltyPoints: vi.fn().mockResolvedValue(undefined),
    addOutstanding: vi.fn().mockResolvedValue(undefined),
    deductOutstanding: vi.fn().mockResolvedValue(undefined),
  };
  const mockS3 = { getPresignedUrl: vi.fn() };
  const mockClickHouse = { insertSaleEvents: vi.fn().mockResolvedValue(undefined) };
  const mockPdfService = { generateAndUpload: vi.fn().mockResolvedValue("invoices/x.pdf") };

  const service = new BillingService(
    mockRepo as any,
    { db: null } as any,
    mockTaxService as any,
    mockBatchRepo as any,
    mockMovementRepo as any,
    mockPatientsRepo as any,
    mockS3 as any,
    mockClickHouse as any,
    mockPdfService as any,
  );

  return { service, mockRepo, mockBatchRepo, mockPatientsRepo, buildTx };
}

const MEDICINE_ROW = {
  id: "med-otc",
  name: "Paracetamol",
  scheduleClass: "OTC",
  requiresPrescription: false,
  taxPercent: "12",
  stripSize: 10,
  isActive: true,
};

const DOCTOR_ROW = { id: "doc-1" };

/** The bill is 112.00 throughout, from the mocked tax service above. */
function runSale(
  service: any,
  mockBatchRepo: any,
  buildTx: any,
  dto: Record<string, unknown>,
  queue: any[][],
) {
  const tx = buildTx(queue);
  service.drizzle = { db: { transaction: vi.fn((cb: any) => cb(tx)) } };
  mockBatchRepo.selectBatchesForDispenseMulti.mockResolvedValue([
    [{ batchId: "batch-1", batchNo: "B001", expiryDate: "2026-06-01", allocate: 2, mrpAtEntry: "560.00" }],
  ]);
  return {
    tx,
    result: service.create(
      {
        items: [{ medicineId: "med-otc", quantity: 2, discountPct: "0" }],
        ...dto,
      } as any,
      "staff-1",
      "branch-1",
    ),
  };
}

describe("CREDIT-01 — a sale handed over entirely on credit", () => {
  it("bills the full amount, pays none of it, and puts the balance on the patient", async () => {
    const { service, mockRepo, mockBatchRepo, mockPatientsRepo, buildTx } = buildService();

    const { tx, result } = runSale(
      service,
      mockBatchRepo,
      buildTx,
      {
        patientId: "patient-1",
        payments: [{ mode: "credit", amount: "0.00" }],
      },
      [[MEDICINE_ROW], [{ id: "batch-1" }]],
    );
    await result;

    const invoice = mockRepo.createInvoiceWithItems.mock.calls[0]![0];
    expect(invoice.totalAmount).toBe("112.00");
    expect(invoice.amountPaid).toBe("0.00");
    expect(invoice.amountDue).toBe("112.00");
    expect(invoice.status).toBe("partially_paid");
    // The invoice still says how it was settled, even though no money moved.
    expect(invoice.paymentMode).toBe("credit");

    // The whole point: the debt is on the customer's account, not lost.
    expect(mockPatientsRepo.addOutstanding).toHaveBeenCalledWith("patient-1", "112.00", tx);

    // ...and no ₹0 receipt in the payments ledger.
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("refuses to leave a balance owing on an anonymous walk-in", async () => {
    const { service, mockBatchRepo, buildTx } = buildService();

    const { result } = runSale(
      service,
      mockBatchRepo,
      buildTx,
      { payments: [{ mode: "credit", amount: "0.00" }] },
      [[MEDICINE_ROW], [{ id: "batch-1" }]],
    );

    await expect(result).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe("CREDIT-02 — part paid at the counter, the rest on account", () => {
  it("records only the money that changed hands and owes the remainder", async () => {
    const { service, mockRepo, mockBatchRepo, mockPatientsRepo, buildTx } = buildService();

    const { tx, result } = runSale(
      service,
      mockBatchRepo,
      buildTx,
      {
        patientId: "patient-1",
        payments: [{ mode: "cash", amount: "50.00" }],
      },
      [[MEDICINE_ROW], [{ id: "batch-1" }]],
    );
    await result;

    const invoice = mockRepo.createInvoiceWithItems.mock.calls[0]![0];
    expect(invoice.amountPaid).toBe("50.00");
    expect(invoice.amountDue).toBe("62.00");
    expect(invoice.status).toBe("partially_paid");
    expect(mockPatientsRepo.addOutstanding).toHaveBeenCalledWith("patient-1", "62.00", tx);
    // One real payment row for the ₹50 actually taken.
    expect(tx.insert).toHaveBeenCalledTimes(1);
  });
});

describe("CREDIT-03 — the doctor a counter sale is credited to", () => {
  it("stamps the doctor on the invoice", async () => {
    const { service, mockRepo, mockBatchRepo, buildTx } = buildService();

    const { result } = runSale(
      service,
      mockBatchRepo,
      buildTx,
      {
        referredByDoctorId: "doc-1",
        payments: [{ mode: "cash", amount: "112.00" }],
      },
      [[MEDICINE_ROW], [DOCTOR_ROW], [{ id: "batch-1" }]],
    );
    await result;

    const invoice = mockRepo.createInvoiceWithItems.mock.calls[0]![0];
    expect(invoice.referredByDoctorId).toBe("doc-1");
  });

  it("rejects a tag that does not name an active doctor", async () => {
    const { service, mockBatchRepo, buildTx } = buildService();

    // The lookup filters on role = doctor and isActive, so a cashier's id — or
    // a retired doctor's — comes back empty.
    const { result } = runSale(
      service,
      mockBatchRepo,
      buildTx,
      {
        referredByDoctorId: "not-a-doctor",
        payments: [{ mode: "cash", amount: "112.00" }],
      },
      [[MEDICINE_ROW], [], [{ id: "batch-1" }]],
    );

    await expect(result).rejects.toThrow(/not an active doctor/i);
  });

  it("leaves the column null on a plain untagged counter sale", async () => {
    const { service, mockRepo, mockBatchRepo, buildTx } = buildService();

    const { result } = runSale(
      service,
      mockBatchRepo,
      buildTx,
      { payments: [{ mode: "cash", amount: "112.00" }] },
      [[MEDICINE_ROW], [{ id: "batch-1" }]],
    );
    await result;

    const invoice = mockRepo.createInvoiceWithItems.mock.calls[0]![0];
    expect(invoice.referredByDoctorId).toBeNull();
  });
});
