import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProcurementService } from "../procurement.service";

/**
 * Payables aging — the overdue flags on a supplier bill and the cross-supplier
 * roll-up built on top of them.
 *
 * Time is frozen so "days past due" is a fixed number rather than drifting
 * with the clock: these assertions are about the banding rule, not about today.
 */

const NOW = new Date("2026-08-17T12:00:00.000Z");

// 10 units at ₹100 + 12% tax = ₹1120.00, matching the ledger spec's fixture.
function billItem(overrides: Record<string, unknown> = {}) {
  return {
    receivedQty: 10,
    freeQty: 0,
    batchId: null,
    poItem: { unitCost: "100.00", taxPct: "12", discountPct: "0", isConsignment: false },
    ...overrides,
  };
}

function grn(id: string, grnNumber: string, receivedAt: string, supplierId: string) {
  return {
    id,
    grnNumber,
    receivedAt,
    supplierInvoiceNo: `INV-${grnNumber}`,
    items: [billItem()],
    purchaseOrder: { id: `po-${id}`, supplierId },
  };
}

describe("Supplier bill overdue flags", () => {
  let service: ProcurementService;
  let mockRepo: any;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    mockRepo = {
      findSupplierById: vi.fn().mockResolvedValue({ id: "sup-1", name: "Apex", creditDays: 30 }),
      // GRN-OLD: received 2026-01-01, due 2026-01-31 — long past due.
      // GRN-NEW: received 2026-08-10, due 2026-09-09 — not yet due.
      getGRNsForSupplier: vi.fn().mockResolvedValue([
        grn("grn-old", "GRN-OLD", "2026-01-01T10:00:00.000Z", "sup-1"),
        grn("grn-new", "GRN-NEW", "2026-08-10T10:00:00.000Z", "sup-1"),
      ]),
      getPaymentsForSupplier: vi.fn().mockResolvedValue([]),
      getSoldQuantitiesForBatches: vi.fn().mockResolvedValue(new Map()),
    };

    service = new ProcurementService(mockRepo, { db: {} } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flags a bill past its due date and counts calendar days late", async () => {
    const { data } = await service.listSupplierBills("sup-1", { page: 1, limit: 20 } as any);

    const old = data.find((b: any) => b.grnNumber === "GRN-OLD")!;
    const fresh = data.find((b: any) => b.grnNumber === "GRN-NEW")!;

    // Due 2026-01-31, measured at 2026-08-17 → 198 calendar days.
    expect(old.isOverdue).toBe(true);
    expect(old.daysOverdue).toBe(198);
    expect(old.status).toBe("unpaid");

    expect(fresh.isOverdue).toBe(false);
    expect(fresh.daysOverdue).toBe(0);
  });

  it("never ages a settled bill, however late it was paid", async () => {
    mockRepo.getPaymentsForSupplier.mockResolvedValue([
      { id: "pay-1", grnId: "grn-old", amount: "1120.00", type: "payment", method: "cash", paidAt: "2026-08-15T10:00:00.000Z" },
    ]);

    const { data } = await service.listSupplierBills("sup-1", { page: 1, limit: 20 } as any);
    const old = data.find((b: any) => b.grnNumber === "GRN-OLD")!;

    expect(old.status).toBe("paid");
    expect(old.balance).toBe("0.00");
    expect(old.isOverdue).toBe(false);
    expect(old.daysOverdue).toBe(0);
  });

  it("filters to overdue bills only, independent of settlement status", async () => {
    // Part-settles the old bill: still owing, still overdue.
    mockRepo.getPaymentsForSupplier.mockResolvedValue([
      { id: "pay-1", grnId: "grn-old", amount: "120.00", type: "payment", method: "cash", paidAt: "2026-08-15T10:00:00.000Z" },
    ]);

    const { data, meta } = await service.listSupplierBills("sup-1", {
      status: "overdue",
      page: 1,
      limit: 20,
    } as any);

    expect(meta.total).toBe(1);
    expect(data[0]!.grnNumber).toBe("GRN-OLD");
    expect(data[0]!.status).toBe("partial");
    expect(data[0]!.balance).toBe("1000.00");
  });
});

describe("Payables aging roll-up", () => {
  let service: ProcurementService;
  let mockRepo: any;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    mockRepo = {
      listSuppliersForAging: vi.fn().mockResolvedValue([
        { id: "sup-1", name: "Apex Supplies", code: "APX", creditDays: 30 },
        { id: "sup-2", name: "Bharat Pharma", code: "BHP", creditDays: 30 },
        { id: "sup-3", name: "Settled Traders", code: "STL", creditDays: 30 },
      ]),
      getAllGRNsWithSupplier: vi.fn().mockResolvedValue([
        // sup-1: due 2026-01-31 → 198 days late → 90+ band
        grn("grn-1", "GRN-1", "2026-01-01T10:00:00.000Z", "sup-1"),
        // sup-1: due 2026-07-25 → 23 days late → 1-30 band
        grn("grn-2", "GRN-2", "2026-06-25T10:00:00.000Z", "sup-1"),
        // sup-2: due 2026-09-09 → not yet due → current
        grn("grn-3", "GRN-3", "2026-08-10T10:00:00.000Z", "sup-2"),
        // sup-3: fully paid below, so it must not appear at all
        grn("grn-4", "GRN-4", "2026-02-01T10:00:00.000Z", "sup-3"),
      ]),
      getAllSupplierPayments: vi.fn().mockResolvedValue([
        { id: "pay-1", supplierId: "sup-3", grnId: "grn-4", amount: "1120.00", type: "payment", method: "cash", paidAt: "2026-03-01T10:00:00.000Z" },
      ]),
      getSoldQuantitiesForBatches: vi.fn().mockResolvedValue(new Map()),
    };

    service = new ProcurementService(mockRepo, { db: {} } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("bands each supplier's open balance and totals the book", async () => {
    const aging = await service.getPayablesAging({ format: "json" } as any);

    expect(aging.suppliers).toHaveLength(2);

    const apex = aging.suppliers.find((s: any) => s.supplierCode === "APX")!;
    expect(apex.d90plus).toBe("1120.00");
    expect(apex.d1_30).toBe("1120.00");
    expect(apex.current).toBe("0.00");
    expect(apex.total).toBe("2240.00");
    expect(apex.overdue).toBe("2240.00");
    expect(apex.overdueBillCount).toBe(2);
    expect(apex.openBillCount).toBe(2);

    const bharat = aging.suppliers.find((s: any) => s.supplierCode === "BHP")!;
    expect(bharat.current).toBe("1120.00");
    expect(bharat.overdue).toBe("0.00");
    expect(bharat.overdueBillCount).toBe(0);

    // Largest exposure first.
    expect(aging.suppliers[0]!.supplierCode).toBe("APX");

    expect(aging.totals.total).toBe("3360.00");
    expect(aging.totals.overdue).toBe("2240.00");
    expect(aging.totals.current).toBe("1120.00");
    expect(aging.totals.supplierCount).toBe(2);
    expect(aging.totals.overdueBillCount).toBe(2);
  });

  it("drops suppliers whose bills are fully settled", async () => {
    const aging = await service.getPayablesAging({ format: "json" } as any);
    expect(aging.suppliers.some((s: any) => s.supplierCode === "STL")).toBe(false);
  });

  it("passes the branch filter through to both bills and payments", async () => {
    await service.getPayablesAging({ format: "json", branchId: "branch-1" } as any);

    expect(mockRepo.getAllGRNsWithSupplier).toHaveBeenCalledWith("branch-1");
    expect(mockRepo.getAllSupplierPayments).toHaveBeenCalledWith("branch-1");
  });
});
