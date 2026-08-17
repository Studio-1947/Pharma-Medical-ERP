import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { BillingService } from "../billing.service";

/**
 * Receivables aging and the patient account statement — the customer-side
 * mirror of the supplier ledger and payables aging.
 *
 * Clock is frozen: the assertions are about how a balance is banded, not
 * about what today happens to be.
 */

const NOW = new Date("2026-08-17T12:00:00.000Z");

function buildService(repoOverrides: Record<string, any> = {}, patientsOverrides: Record<string, any> = {}) {
  const mockRepo = {
    openReceivables: vi.fn().mockResolvedValue([]),
    getPatientLedgerRows: vi.fn().mockResolvedValue({ invoices: [], payments: [] }),
    ...repoOverrides,
  };
  const mockPatientsRepo = {
    findById: vi.fn().mockResolvedValue({
      id: "pat-1",
      name: "Asha Verma",
      phone: "9876543210",
      outstandingBalance: "0.00",
    }),
    ...patientsOverrides,
  };

  const service = new BillingService(
    mockRepo as any,
    { db: null } as any,
    {} as any,
    {} as any,
    {} as any,
    mockPatientsRepo as any,
    {} as any,
    {} as any,
    {} as any,
  );

  return { service, mockRepo, mockPatientsRepo };
}

describe("Receivables aging", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("bands open dues per patient and totals the book", async () => {
    const { service } = buildService({
      openReceivables: vi.fn().mockResolvedValue([
        // 228 days old → 90+
        { id: "inv-1", invoiceNo: "B-1", patientId: "pat-1", patientName: "Asha Verma", patientPhone: "98765", totalAmount: "500.00", amountPaid: "300.00", amountDue: "200.00", createdAt: "2026-01-01T10:00:00.000Z" },
        // 22 days old → 1-30
        { id: "inv-2", invoiceNo: "B-2", patientId: "pat-1", patientName: "Asha Verma", patientPhone: "98765", totalAmount: "150.00", amountPaid: "0.00", amountDue: "150.00", createdAt: "2026-07-26T10:00:00.000Z" },
        // raised today → current
        { id: "inv-3", invoiceNo: "B-3", patientId: "pat-2", patientName: "Ravi Nair", patientPhone: "91234", totalAmount: "90.00", amountPaid: "0.00", amountDue: "90.00", createdAt: "2026-08-17T09:00:00.000Z" },
      ]),
    });

    const aging = await service.getReceivablesAging({ format: "json" } as any);

    const asha = aging.patients.find((p: any) => p.patientId === "pat-1")!;
    expect(asha.d90plus).toBe("200.00");
    expect(asha.d1_30).toBe("150.00");
    expect(asha.total).toBe("350.00");
    expect(asha.overdue).toBe("350.00");
    expect(asha.invoiceCount).toBe(2);
    expect(asha.overdueInvoiceCount).toBe(2);
    expect(asha.oldestInvoiceDate).toBe("2026-01-01T10:00:00.000Z");

    const ravi = aging.patients.find((p: any) => p.patientId === "pat-2")!;
    expect(ravi.current).toBe("90.00");
    expect(ravi.overdue).toBe("0.00");
    expect(ravi.overdueInvoiceCount).toBe(0);

    // Largest exposure first.
    expect(aging.patients[0]!.patientId).toBe("pat-1");

    expect(aging.totals.total).toBe("440.00");
    expect(aging.totals.overdue).toBe("350.00");
    expect(aging.totals.current).toBe("90.00");
    expect(aging.totals.patientCount).toBe(2);
    expect(aging.totals.overdueInvoiceCount).toBe(2);
  });

  it("keeps an unassigned due in the totals under a synthetic row", async () => {
    const { service } = buildService({
      openReceivables: vi.fn().mockResolvedValue([
        { id: "inv-9", invoiceNo: "B-9", patientId: null, patientName: null, patientPhone: null, totalAmount: "75.00", amountPaid: "0.00", amountDue: "75.00", createdAt: "2026-05-01T10:00:00.000Z" },
      ]),
    });

    const aging = await service.getReceivablesAging({ format: "json" } as any);

    expect(aging.patients).toHaveLength(1);
    expect(aging.patients[0]!.patientId).toBeNull();
    expect(aging.patients[0]!.patientName).toBe("Walk-in / unassigned");
    expect(aging.totals.total).toBe("75.00");
  });

  it("passes the branch filter to the repository", async () => {
    const { service, mockRepo } = buildService();
    await service.getReceivablesAging({ format: "json", branchId: "branch-1" } as any);
    expect(mockRepo.openReceivables).toHaveBeenCalledWith("branch-1");
  });
});

describe("Patient ledger", () => {
  it("computes debit, credit and running balance", async () => {
    const { service } = buildService(
      {
        getPatientLedgerRows: vi.fn().mockResolvedValue({
          invoices: [
            { id: "inv-1", invoiceNo: "B-1", isReturn: false, totalAmount: "500.00", amountDue: "200.00", status: "partially_paid", createdAt: "2026-08-01T10:00:00.000Z" },
          ],
          payments: [
            { id: "pay-1", invoiceId: "inv-1", invoiceNo: "B-1", amount: "300.00", mode: "cash", referenceNo: null, createdAt: "2026-08-01T10:00:00.000Z" },
          ],
        }),
      },
      {
        findById: vi.fn().mockResolvedValue({
          id: "pat-1",
          name: "Asha Verma",
          phone: "9876543210",
          outstandingBalance: "200.00",
        }),
      },
    );

    const ledger = await service.getPatientLedger("pat-1", { format: "json" } as any);

    expect(ledger.entries).toHaveLength(2);
    expect(ledger.entries[0]).toMatchObject({ type: "invoice", reference: "B-1", debit: "500.00", credit: "0.00", balance: "500.00" });
    expect(ledger.entries[1]).toMatchObject({ type: "payment", debit: "0.00", credit: "300.00", balance: "200.00" });
    expect(ledger.closingBalance).toBe("200.00");
    // The computed balance and the column the POS reads must agree.
    expect(ledger.storedOutstanding).toBe("200.00");
  });

  it("nets a return and its refund to zero on the balance", async () => {
    const { service } = buildService({
      getPatientLedgerRows: vi.fn().mockResolvedValue({
        invoices: [
          { id: "inv-1", invoiceNo: "B-1", isReturn: false, totalAmount: "500.00", amountDue: "0.00", status: "confirmed", createdAt: "2026-08-01T10:00:00.000Z" },
          { id: "inv-2", invoiceNo: "B-2", isReturn: true, totalAmount: "-150.00", amountDue: "0.00", status: "confirmed", createdAt: "2026-08-05T10:00:00.000Z" },
        ],
        payments: [
          { id: "pay-1", invoiceId: "inv-1", invoiceNo: "B-1", amount: "500.00", mode: "cash", referenceNo: null, createdAt: "2026-08-01T10:00:00.000Z" },
          { id: "pay-2", invoiceId: "inv-2", invoiceNo: "B-2", amount: "-150.00", mode: "cash", referenceNo: null, createdAt: "2026-08-05T10:00:00.000Z" },
        ],
      }),
    });

    const ledger = await service.getPatientLedger("pat-1", { format: "json" } as any);

    expect(ledger.entries.map((e: any) => e.type)).toEqual(["invoice", "payment", "credit_note", "refund"]);
    expect(ledger.closingBalance).toBe("0.00");
  });

  it("windows entries by date and carries an opening balance", async () => {
    const { service } = buildService({
      getPatientLedgerRows: vi.fn().mockResolvedValue({
        invoices: [
          { id: "inv-1", invoiceNo: "B-1", isReturn: false, totalAmount: "500.00", amountDue: "500.00", status: "partially_paid", createdAt: "2026-07-01T10:00:00.000Z" },
          { id: "inv-2", invoiceNo: "B-2", isReturn: false, totalAmount: "200.00", amountDue: "200.00", status: "partially_paid", createdAt: "2026-08-05T10:00:00.000Z" },
        ],
        payments: [],
      }),
    });

    const ledger = await service.getPatientLedger("pat-1", { format: "json", from: "2026-08-01" } as any);

    expect(ledger.openingBalance).toBe("500.00");
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]!.reference).toBe("B-2");
    expect(ledger.closingBalance).toBe("700.00");
  });

  it("rejects an unknown patient", async () => {
    const { service } = buildService({}, { findById: vi.fn().mockResolvedValue(null) });
    await expect(service.getPatientLedger("nope", { format: "json" } as any)).rejects.toBeInstanceOf(NotFoundException);
  });
});
