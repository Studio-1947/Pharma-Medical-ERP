import { describe, it, expect, vi, beforeEach } from "vitest";
import { BillingService } from "../billing.service";
import { UnprocessableEntityException, NotFoundException } from "@nestjs/common";

describe("BillingService (Compliance)", () => {
  let service: BillingService;
  let mockRepo: any;
  let mockDrizzle: any;
  let mockTaxService: any;
  let mockBatchRepo: any;
  let mockMovementRepo: any;

  beforeEach(() => {
    mockRepo = {
      nextInvoiceNumber: vi.fn().mockResolvedValue("INV-001"),
      createInvoiceWithItems: vi.fn().mockResolvedValue({ invoice: { id: "inv-1" }, items: [] }),
      findById: vi.fn(),
    };

    // More robust chainable mock
    const createMockDb = () => {
        const chain: any = {
            select: vi.fn(),
            from: vi.fn(),
            where: vi.fn(),
            innerJoin: vi.fn(),
            orderBy: vi.fn(),
            limit: vi.fn(),
            returning: vi.fn(),
            values: vi.fn(),
            set: vi.fn(),
            insert: vi.fn(),
            update: vi.fn(),
        };

        chain.select.mockReturnValue(chain);
        chain.from.mockReturnValue(chain);
        chain.where.mockReturnValue(chain);
        chain.innerJoin.mockReturnValue(chain);
        chain.orderBy.mockReturnValue(chain);
        chain.limit.mockReturnValue(chain);
        chain.returning.mockReturnValue(chain);
        chain.values.mockReturnValue(chain);
        chain.set.mockReturnValue(chain);
        chain.insert.mockReturnValue(chain);
        chain.update.mockReturnValue(chain);

        // Standard thenable implementation
        chain.then = (onRes: any) => {
            return Promise.resolve(chain._results?.shift() || []).then(onRes);
        };
        
        chain._results = [];
        chain.mockResults = (results: any[]) => {
            chain._results = results;
        };

        return chain;
    };

    const mockDb = createMockDb();

    mockDrizzle = {
      db: {
        transaction: vi.fn((cb) => cb(mockDb)),
        ...mockDb
      },
    };

    mockTaxService = {
      calculateLineTax: vi.fn(),
      aggregateInvoiceTotals: vi.fn(),
    };
    mockBatchRepo = {
      selectBatchesForDispense: vi.fn(),
      adjustQuantity: vi.fn(),
    };
    mockMovementRepo = {
      log: vi.fn(),
    };

    const mockPdfQueue = {
      add: vi.fn(),
    };

    const mockS3 = {
      getPresignedUrl: vi.fn(),
    };

    const mockPatientsRepo = {
      addLoyaltyPoints: vi.fn(),
      deductLoyaltyPoints: vi.fn(),
    };

    service = new BillingService(
      mockRepo,
      mockDrizzle,
      mockTaxService,
      mockBatchRepo,
      mockMovementRepo,
      mockPatientsRepo as any,
      mockS3 as any,
      mockPdfQueue as any,
    );
  });

  describe("Schedule H Gate (BILL-04)", () => {
    it("should throw UnprocessableEntityException for Schedule H without prescription", async () => {
      const dto = {
        branchId: "b1",
        items: [{ medicineId: "med-h", quantity: 1 }],
        payments: [{ mode: "cash", amount: "100" }],
      };

      mockDrizzle.db.mockResults([
        [{                                     // Medicine
          id: "med-h",
          name: "Restricted Med",
          scheduleClass: "SCHEDULE_H",
          isActive: true,
          taxPercent: "12"
        }]
      ]);

      await expect(service.create(dto as any, "staff-1")).rejects.toThrow(UnprocessableEntityException);
    });

    it("should allow Schedule H with verified prescription", async () => {
        const dto = {
          branchId: "b1",
          prescriptionId: "rx-1",
          items: [{ medicineId: "med-h", quantity: 1 }],
          payments: [{ mode: "cash", amount: "112.00" }],
        };
  
        mockDrizzle.db.mockResults([
            [{                                     // Medicine
              id: "med-h",
              name: "Restricted Med",
              scheduleClass: "SCHEDULE_H",
              isActive: true,
              taxPercent: "12"
            }],
            [{                                     // Prescription
                status: "verified",
                expiryDate: "2099-01-01",
                id: "rx-1"
            }],
            [{                                     // Prescription items check
                id: "rx-item-1",
                quantityPrescribed: 5,
                quantityDispensed: 0,
                isFullyDispensed: false
            }],
            [{ id: "b1" }],                        // Batch update returning
            [{                                     // Prescription items update select
                id: "rx-item-1",
                quantityPrescribed: 5,
                quantityDispensed: 0
            }]
        ]);

        mockBatchRepo.selectBatchesForDispense.mockResolvedValue([{
            batchId: "b1",
            batchNo: "B001",
            allocate: 1,
            mrpAtEntry: "100.00"
        }]);

        mockTaxService.calculateLineTax.mockReturnValue({
            lineTotal: 112,
            taxAmount: 12,
            breakdown: { cgst: 6, sgst: 6, igst: 0, taxableAmount: 100 }
        });
        mockTaxService.aggregateInvoiceTotals.mockReturnValue({
            subtotal: 100,
            taxAmount: 12,
            totalAmount: 112
        });

        const result = await service.create(dto as any, "staff-1");
        expect(result.invoice.id).toBe("inv-1");
      });
  });

  describe("Payment Sum Validation (BILL-09)", () => {
    it("should throw if payment sum does not match total", async () => {
      const dto = {
        branchId: "b1",
        items: [{ medicineId: "m1", quantity: 1 }],
        payments: [{ mode: "cash", amount: "50" }], // Should be 112
      };

      mockDrizzle.db.mockResults([
        [{                                     // Medicine
          id: "m1",
          scheduleClass: "OTC",
          isActive: true,
          taxPercent: "12"
        }]
      ]);

      mockBatchRepo.selectBatchesForDispense.mockResolvedValue([{
        batchId: "b1",
        batchNo: "B001",
        allocate: 1,
        mrpAtEntry: "100.00"
      }]);

      mockTaxService.calculateLineTax.mockReturnValue({
        lineTotal: 112,
        taxAmount: 12,
        breakdown: { taxableAmount: 100 },
      });
      mockTaxService.aggregateInvoiceTotals.mockReturnValue({
        subtotal: 100,
        taxAmount: 12,
        totalAmount: 112,
      });

      await expect(service.create(dto as any, "staff-1")).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe("Void Invoice — race condition guard (BILL-11)", () => {
    it("should throw if invoice is already voided (status = cancelled)", async () => {
      mockRepo.findById.mockResolvedValue({
        id: "inv-1",
        status: "cancelled",
        items: [],
        payments: [],
        branchId: "b1",
      });

      // findOne wraps findById
      mockRepo.findById.mockResolvedValue({
        id: "inv-1",
        status: "cancelled",
        items: [],
      });

      // Simulate the tx conditional update returning nothing (already cancelled)
      const txMock = {
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([]),
      };
      mockDrizzle.db.transaction = vi.fn((cb) => cb(txMock));

      await expect(
        service.voidInvoice("inv-1", { reason: "test" }, "staff-1"),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it("should not attempt double stock return on concurrent void", async () => {
      const items = [{ batchId: "batch-1", medicineId: "med-1", quantity: 2 }];
      mockRepo.findById.mockResolvedValue({
        id: "inv-1",
        status: "confirmed",
        items,
      });

      let callCount = 0;
      const txMock: any = {
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockImplementation(() => {
          callCount++;
          // First call: status update claiming the void
          if (callCount === 1) return Promise.resolve([{ id: "inv-1" }]);
          return Promise.resolve([{ id: "batch-1" }]);
        }),
      };
      mockDrizzle.db.transaction = vi.fn((cb) => cb(txMock));

      await service.voidInvoice("inv-1", { reason: "error entry" }, "staff-1");
      expect(mockMovementRepo.log).toHaveBeenCalledTimes(1);
    });
  });
});
