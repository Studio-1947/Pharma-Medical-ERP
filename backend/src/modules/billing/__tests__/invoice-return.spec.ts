import { describe, it, expect, vi, beforeEach } from "vitest";
import { UnprocessableEntityException, NotFoundException } from "@nestjs/common";
import { BillingService } from "../billing.service";

/**
 * Returns were unreachable: createReturn gated on status === "confirmed", but
 * create() only ever writes "paid" or "partially_paid" and recordPayment()
 * settles a credit sale to "paid". Nothing the POS produced could be returned;
 * every call came back 422.
 *
 * These tests drive the gate with the statuses the system actually writes, and
 * cover the money split that returning a credit sale introduced — cancelling
 * what is still owed before paying anything back.
 */

interface TxCall {
  table: string;
  values?: any;
  set?: any;
}

function buildService() {
  const txCalls: TxCall[] = [];

  const tx: any = {
    insert: vi.fn((table: any) => ({
      values: vi.fn((values: any) => {
        txCalls.push({ table: tableName(table), values });
        return Promise.resolve([]);
      }),
    })),
    update: vi.fn((table: any) => ({
      set: vi.fn((set: any) => ({
        where: vi.fn(() => {
          txCalls.push({ table: tableName(table), set });
          return Promise.resolve([]);
        }),
      })),
    })),
  };

  const repo: any = {
    findById: vi.fn(),
    findReturnedQuantities: vi.fn().mockResolvedValue({}),
    nextInvoiceNumber: vi.fn().mockResolvedValue("BR1-20260818-00002"),
    createInvoiceWithItems: vi
      .fn()
      .mockImplementation((invoiceData: any) =>
        Promise.resolve({ invoice: { id: "ret-1", ...invoiceData }, items: [] }),
      ),
  };

  const patientsRepo: any = { deductOutstanding: vi.fn().mockResolvedValue(undefined) };
  const movementRepo: any = { log: vi.fn().mockResolvedValue(undefined) };
  const drizzle: any = { db: { transaction: vi.fn((cb: any) => cb(tx)) } };

  const service = new BillingService(
    repo,
    drizzle,
    {} as any,
    {} as any,
    movementRepo,
    patientsRepo,
    {} as any,
    {} as any,
    {} as any,
  );

  return { service, repo, patientsRepo, movementRepo, txCalls };
}

/** Drizzle tables carry their SQL name on a symbol; fall back to a guess. */
function tableName(table: any): string {
  const sym = Object.getOwnPropertySymbols(table ?? {}).find((s) =>
    String(s).includes("Name"),
  );
  return (sym ? table[sym] : undefined) ?? "unknown";
}

/** One line, 10 units at 100.00, 5% CGST + 5% SGST. */
function invoiceFixture(overrides: Record<string, any> = {}) {
  return {
    id: "inv-1",
    invoiceNo: "BR1-20260818-00001",
    status: "paid",
    branchId: "branch-1",
    patientId: "patient-1",
    prescriptionId: null,
    amountDue: "0.00",
    amountPaid: "1000.00",
    totalAmount: "1000.00",
    payments: [{ mode: "cash" }],
    items: [
      {
        id: "item-1",
        medicineId: "med-1",
        batchId: "batch-1",
        quantity: 10,
        unitPrice: "100.00",
        discountPct: "0",
        taxPct: "10",
        lineTotal: "1000.00",
        cgstAmt: "50.00",
        sgstAmt: "50.00",
        igstAmt: "0.00",
      },
    ],
    ...overrides,
  };
}

const returnAll = { items: [{ invoiceItemId: "item-1", returnQty: 10 }], reason: "damaged" };

describe("createReturn — status gate", () => {
  let h: ReturnType<typeof buildService>;
  beforeEach(() => {
    h = buildService();
  });

  it.each(["paid", "partially_paid", "confirmed"])(
    "accepts a %s invoice",
    async (status) => {
      // partially_paid needs a due for the split; give every case the same
      // fully-settled shape except the status under test.
      h.repo.findById.mockResolvedValue(invoiceFixture({ status }));
      await expect(
        h.service.createReturn("inv-1", returnAll as any, "staff-1"),
      ).resolves.toMatchObject({ message: expect.stringContaining("Return processed") });
    },
  );

  it.each(["draft", "cancelled", "refunded"])(
    "refuses a %s invoice and names the status",
    async (status) => {
      h.repo.findById.mockResolvedValue(invoiceFixture({ status }));
      await expect(
        h.service.createReturn("inv-1", returnAll as any, "staff-1"),
      ).rejects.toThrow(UnprocessableEntityException);
      await expect(
        h.service.createReturn("inv-1", returnAll as any, "staff-1"),
      ).rejects.toThrow(new RegExp(status));
    },
  );

  it("refuses an invoice that does not exist", async () => {
    h.repo.findById.mockResolvedValue(undefined);
    await expect(
      h.service.createReturn("nope", returnAll as any, "staff-1"),
    ).rejects.toThrow(NotFoundException);
  });
});

describe("createReturn — a fully-paid invoice refunds cash", () => {
  it("pays the whole credit back and leaves the patient's balance alone", async () => {
    const h = buildService();
    h.repo.findById.mockResolvedValue(invoiceFixture({ amountDue: "0.00" }));

    const res: any = await h.service.createReturn("inv-1", returnAll as any, "staff-1");

    expect(res.data.cashRefund).toBe("1000.00");
    expect(res.data.creditAgainstDue).toBe("0.00");

    const payment = h.txCalls.find((c) => c.values?.invoiceId === "ret-1");
    expect(payment?.values.amount).toBe("-1000.00");

    // Nothing owed, so nothing to write down.
    expect(h.patientsRepo.deductOutstanding).not.toHaveBeenCalled();
  });

  it("restocks the batch and logs one movement", async () => {
    const h = buildService();
    h.repo.findById.mockResolvedValue(invoiceFixture());

    await h.service.createReturn("inv-1", returnAll as any, "staff-1");

    expect(h.movementRepo.log).toHaveBeenCalledTimes(1);
    expect(h.movementRepo.log).toHaveBeenCalledWith(
      expect.objectContaining({
        batchId: "batch-1",
        movementType: "return",
        quantity: 10,
        branchId: "branch-1",
      }),
      expect.anything(),
    );
  });
});

describe("createReturn — a credit sale cancels the due before paying out", () => {
  it("writes the whole credit off against a larger outstanding due, refunding nothing", async () => {
    const h = buildService();
    h.repo.findById.mockResolvedValue(
      invoiceFixture({ status: "partially_paid", amountDue: "1000.00", amountPaid: "0.00" }),
    );

    const res: any = await h.service.createReturn("inv-1", returnAll as any, "staff-1");

    expect(res.data.creditAgainstDue).toBe("1000.00");
    expect(res.data.cashRefund).toBe("0.00");
    expect(res.message).toContain("written off");

    // No cash moved, so no payment row may exist — one would overstate refunds
    // in the day's takings.
    expect(h.txCalls.some((c) => c.values?.invoiceId === "ret-1")).toBe(false);

    expect(h.patientsRepo.deductOutstanding).toHaveBeenCalledWith(
      "patient-1",
      "1000.00",
      expect.anything(),
    );
  });

  it("settles the original invoice when the return clears its balance", async () => {
    const h = buildService();
    h.repo.findById.mockResolvedValue(
      invoiceFixture({ status: "partially_paid", amountDue: "1000.00", amountPaid: "0.00" }),
    );

    await h.service.createReturn("inv-1", returnAll as any, "staff-1");

    const originalUpdate = h.txCalls.find((c) => c.set?.amountDue !== undefined);
    expect(originalUpdate?.set.amountDue).toBe("0.00");
    expect(originalUpdate?.set.status).toBe("paid");
  });

  it("splits a credit that exceeds the due: cancel what is owed, refund the rest", async () => {
    const h = buildService();
    // Patient paid 600 of 1000 and is returning all 1000 of goods.
    h.repo.findById.mockResolvedValue(
      invoiceFixture({ status: "partially_paid", amountDue: "400.00", amountPaid: "600.00" }),
    );

    const res: any = await h.service.createReturn("inv-1", returnAll as any, "staff-1");

    expect(res.data.creditAgainstDue).toBe("400.00");
    expect(res.data.cashRefund).toBe("600.00");

    const payment = h.txCalls.find((c) => c.values?.invoiceId === "ret-1");
    expect(payment?.values.amount).toBe("-600.00");

    expect(h.patientsRepo.deductOutstanding).toHaveBeenCalledWith(
      "patient-1",
      "400.00",
      expect.anything(),
    );
  });

  it("leaves a partial balance standing when the return is smaller than the due", async () => {
    const h = buildService();
    h.repo.findById.mockResolvedValue(
      invoiceFixture({ status: "partially_paid", amountDue: "1000.00", amountPaid: "0.00" }),
    );

    // Return 3 of 10 units => 300.00 of credit against a 1000.00 due.
    const res: any = await h.service.createReturn(
      "inv-1",
      { items: [{ invoiceItemId: "item-1", returnQty: 3 }], reason: "wrong strength" } as any,
      "staff-1",
    );

    expect(res.data.creditAgainstDue).toBe("300.00");
    expect(res.data.cashRefund).toBe("0.00");

    const originalUpdate = h.txCalls.find((c) => c.set?.amountDue !== undefined);
    expect(originalUpdate?.set.amountDue).toBe("700.00");
    // Still owed, so it must not be marked settled.
    expect(originalUpdate?.set.status).toBeUndefined();
  });

  it("does not touch a patient balance on a walk-in credit note", async () => {
    const h = buildService();
    h.repo.findById.mockResolvedValue(
      invoiceFixture({ patientId: null, amountDue: "0.00" }),
    );

    await h.service.createReturn("inv-1", returnAll as any, "staff-1");
    expect(h.patientsRepo.deductOutstanding).not.toHaveBeenCalled();
  });
});

describe("createReturn — lock ordering", () => {
  it("restocks the batches before allocating the invoice number", async () => {
    const h = buildService();
    h.repo.findById.mockResolvedValue(invoiceFixture());

    await h.service.createReturn("inv-1", returnAll as any, "staff-1");

    // create() takes the batch locks first (FEFO selects FOR UPDATE) and the
    // sequence row second. If a return took them the other way round, a
    // concurrent sale and return on the same branch would each hold what the
    // other waits for and Postgres would kill one of them mid-checkout.
    const batchUpdateAt = h.movementRepo.log.mock.invocationCallOrder[0]!;
    const sequenceAt = h.repo.nextInvoiceNumber.mock.invocationCallOrder[0]!;

    expect(batchUpdateAt).toBeLessThan(sequenceAt);
  });

  it("allocates the number inside the transaction, not before it", async () => {
    const h = buildService();
    h.repo.findById.mockResolvedValue(invoiceFixture());

    await h.service.createReturn("inv-1", returnAll as any, "staff-1");

    // A credit note that fails to write must give its number back rather than
    // leave a gap in the branch's series.
    expect(h.repo.nextInvoiceNumber).toHaveBeenCalledWith("branch-1", expect.anything());
    expect(h.repo.nextInvoiceNumber.mock.calls[0]![1]).toBeDefined();
  });
});

describe("createReturn — over-return guard still holds", () => {
  it("refuses to return more units than remain eligible", async () => {
    const h = buildService();
    h.repo.findById.mockResolvedValue(invoiceFixture());
    h.repo.findReturnedQuantities.mockResolvedValue({ "med-1:batch-1": 8 });

    await expect(
      h.service.createReturn("inv-1", returnAll as any, "staff-1"),
    ).rejects.toThrow(/only 2 units eligible/);
  });
});
