import { describe, it, expect, vi } from "vitest";
import { BillingService } from "../billing.service";
import { UnprocessableEntityException } from "@nestjs/common";

/**
 * The rxPending guard — a bill may only owe a prescription if something on it
 * actually needs one.
 *
 * rxPending marks an invoice as "a manager vouched for a prescription they have
 * seen, the paper is still to be attached". It puts the bill in the pending-Rx
 * worklist until someone attaches the document. On a bill with nothing
 * controlled on it there is no document that could ever be attached, so the
 * flag would never clear and would sit in that worklist for good, next to the
 * real ones.
 *
 * The counter reached this through a leaked flag rather than a deliberate act:
 * the POS held the manager's attestation in component state and never dropped
 * it after the sale, so the next customer's ordinary OTC bill carried it too
 * and was refused, with no Rx panel on screen to explain why. The client now
 * clears it (see the effects in pos-terminal.tsx and otc-counter-sale.tsx);
 * this suite pins the server side of that contract, which is what makes the
 * flag trustworthy in the first place.
 */

const OTC_MEDICINE = {
  id: "med-otc",
  name: "Paracetamol",
  scheduleClass: "OTC",
  requiresPrescription: false,
  taxPercent: "12",
  stripSize: 10,
  isActive: true,
};

// The imported catalogue writes the bare letter, not "SCHEDULE_H".
const CONTROLLED_MEDICINE = {
  id: "med-h",
  name: "Alprazolam 0.25 mg",
  scheduleClass: "H",
  requiresPrescription: true,
  taxPercent: "12",
  stripSize: 10,
  isActive: true,
};

const MANAGER = { role: "shop_manager" };

function buildService() {
  const mockRepo = {
    findByClientRef: vi.fn().mockResolvedValue(null),
    nextInvoiceNumber: vi.fn().mockResolvedValue("INV-20260820-0001"),
    findTokenNoByPrescription: vi.fn().mockResolvedValue(null),
    createInvoiceWithItems: vi.fn().mockResolvedValue({
      invoice: { id: "inv-1", invoiceNo: "INV-20260820-0001" },
      items: [],
    }),
    findById: vi.fn(),
  };

  // Chainable Drizzle stand-in: each awaited query pops the next queued result.
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
    selectBatchesForDispenseMulti: vi.fn().mockResolvedValue([
      [{ batchId: "batch-1", batchNo: "B001", expiryDate: "2027-06-01", allocate: 2, mrpAtEntry: "560.00" }],
    ]),
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

  const service = new BillingService(
    mockRepo as any,
    { db: null } as any,
    mockTaxService as any,
    mockBatchRepo as any,
    { log: vi.fn().mockResolvedValue(undefined), logMany: vi.fn().mockResolvedValue(undefined) } as any,
    {
      addLoyaltyPoints: vi.fn().mockResolvedValue(undefined),
      deductLoyaltyPoints: vi.fn().mockResolvedValue(undefined),
      addOutstanding: vi.fn().mockResolvedValue(undefined),
      deductOutstanding: vi.fn().mockResolvedValue(undefined),
    } as any,
    { getPresignedUrl: vi.fn() } as any,
    { insertSaleEvents: vi.fn().mockResolvedValue(undefined) } as any,
    { generateAndUpload: vi.fn().mockResolvedValue("invoices/INV-001.pdf") } as any,
  );

  return { service, mockRepo, buildTx };
}

/**
 * Query order inside createInTransaction, which is what the queue feeds: the
 * medicines lookup, then the override approver (only when the sale carries
 * override fields — no prescriptionId is passed in this suite, so the
 * prescription queries never run), then the UPDATE…RETURNING that deducts the
 * batch. A short queue reads as "someone else took the stock" and fails the
 * sale for the wrong reason, so the two shapes are spelled out separately.
 */
function attach(service: any, buildTx: any, medicine: any, withOverride: boolean) {
  const tx = buildTx(
    withOverride
      ? [[medicine], [MANAGER], [{ id: "batch-1" }]]
      : [[medicine], [{ id: "batch-1" }]],
  );
  service.drizzle = { db: { transaction: vi.fn((cb: any) => cb(tx)) } };
  return tx;
}

function attestedSale(medicineId: string) {
  return {
    items: [{ medicineId, quantity: 2, discountPct: "0" }],
    payments: [{ mode: "cash", amount: "112.00" }],
    rxPending: true,
    overriddenBy: "mgr-1",
    overrideReason: "Manager verified the prescription at the counter; prescription to be attached",
  } as any;
}

describe("rxPending guard", () => {
  it("refuses to record a prescription debt on a bill with nothing controlled on it", async () => {
    const { service, buildTx } = buildService();
    attach(service, buildTx, OTC_MEDICINE, true);

    await expect(
      service.create(attestedSale("med-otc"), "staff-1", "branch-1"),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it("says so in words the counter can act on", async () => {
    const { service, buildTx } = buildService();
    attach(service, buildTx, OTC_MEDICINE, true);

    await expect(
      service.create(attestedSale("med-otc"), "staff-1", "branch-1"),
    ).rejects.toThrow(/Nothing on this bill needs a prescription/i);
  });

  it("writes nothing when it refuses — no half-made invoice left behind", async () => {
    const { service, mockRepo, buildTx } = buildService();
    attach(service, buildTx, OTC_MEDICINE, true);

    await expect(
      service.create(attestedSale("med-otc"), "staff-1", "branch-1"),
    ).rejects.toThrow(UnprocessableEntityException);

    expect(mockRepo.createInvoiceWithItems).not.toHaveBeenCalled();
  });

  it("lets the vouched-for Schedule H sale through and carries the debt on the invoice", async () => {
    // The guard must not become a blanket refusal: this is the whole point of
    // the flag, and blocking it would send the counter back to "bill it
    // somewhere else", which is where this started.
    const { service, mockRepo, buildTx } = buildService();
    attach(service, buildTx, CONTROLLED_MEDICINE, true);

    await service.create(attestedSale("med-h"), "staff-1", "branch-1");

    expect(mockRepo.createInvoiceWithItems).toHaveBeenCalledTimes(1);
    const [invoicePayload] = mockRepo.createInvoiceWithItems.mock.calls[0] as [any, ...any[]];
    expect(invoicePayload.rxPending).toBe(true);
  });

  it("leaves an ordinary OTC sale with no debt against it", async () => {
    const { service, mockRepo, buildTx } = buildService();
    attach(service, buildTx, OTC_MEDICINE, false);

    await service.create(
      {
        items: [{ medicineId: "med-otc", quantity: 2, discountPct: "0" }],
        payments: [{ mode: "cash", amount: "112.00" }],
      } as any,
      "staff-1",
      "branch-1",
    );

    const [invoicePayload] = mockRepo.createInvoiceWithItems.mock.calls[0] as [any, ...any[]];
    expect(invoicePayload.rxPending).toBe(false);
  });
});
