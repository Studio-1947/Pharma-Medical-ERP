import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProcurementService } from "../procurement.service";

describe("Supplier Ledger Audit", () => {
  let service: ProcurementService;
  let mockRepo: any;
  let mockDrizzle: any;

  beforeEach(() => {
    mockRepo = {
      findSupplierById: vi.fn().mockResolvedValue({
        id: "sup-1",
        name: "Apex Supplies",
        creditDays: 30,
      }),
      getGRNsForSupplier: vi.fn().mockResolvedValue([
        {
          id: "grn-1",
          grnNumber: "GRN-101",
          receivedAt: "2026-08-01T10:00:00.000Z",
          supplierInvoiceNo: "INV-9901",
          items: [
            {
              receivedQty: 10,
              freeQty: 0,
              poItem: { unitCost: "100.00", taxPct: "12", discountPct: "0", isConsignment: false },
            },
          ],
        },
      ]),
      getPaymentsForSupplier: vi.fn().mockResolvedValue([
        {
          id: "pay-1",
          amount: "500.00",
          method: "bank_transfer",
          type: "payment",
          referenceNo: "TXN-12345",
          paidAt: "2026-08-02T10:00:00.000Z",
        },
      ]),
      getSoldQuantitiesForBatches: vi.fn().mockResolvedValue(new Map()),
    };

    mockDrizzle = { db: {} };

    service = new ProcurementService(mockRepo, mockDrizzle);
  });

  it("computes supplier ledger debit, credit, and running balance correctly", async () => {
    const ledger = await service.getSupplierLedger("sup-1", { page: 1, limit: 20 });
    
    expect(ledger.supplierId).toBe("sup-1");
    expect(ledger.entries).toHaveLength(2);
    
    // Delivery bill entry (Debit)
    expect(ledger.entries[0]?.type).toBe("bill");
    expect(ledger.entries[0]?.reference).toBe("GRN-101");
    expect(ledger.entries[0]?.debit).toBe("1120.00");
    expect(ledger.entries[0]?.credit).toBe("0.00");
    expect(ledger.entries[0]?.balance).toBe("1120.00");

    // Payment entry (Credit)
    expect(ledger.entries[1]?.type).toBe("payment");
    expect(ledger.entries[1]?.debit).toBe("0.00");
    expect(ledger.entries[1]?.credit).toBe("500.00");
    expect(ledger.entries[1]?.balance).toBe("620.00");

    expect(ledger.closingBalance).toBe("620.00");
  });
});
