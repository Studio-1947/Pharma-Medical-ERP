import { describe, it, expect, vi, beforeEach } from "vitest";
import { BatchService } from "../batch.service";
import { createBatchSchema, queryBatchSchema } from "@pharmerp/types";

/**
 * Cost price is optional when receiving a batch — the pack routinely reaches
 * the shelf before its invoice does, and holding stock off the shelf until
 * someone knows the landed cost helps nobody.
 *
 * inventory_batches.cost_price is NOT NULL and is what stock valuation sums,
 * so an omitted cost must still resolve to a defensible figure rather than
 * booking the batch in at zero.
 */
describe("BatchService.create — optional cost price", () => {
  let service: BatchService;
  let batchRepo: any;
  let inventoryRepo: any;

  const branchId = "11111111-1111-1111-1111-111111111111";

  const baseDto = {
    medicineId: "22222222-2222-2222-2222-222222222222",
    batchNo: "B-001",
    expiryDate: "2027-06-30",
    quantity: 50,
    mrpAtEntry: "100.00",
  };

  beforeEach(() => {
    batchRepo = {
      createBatch: vi.fn().mockResolvedValue({ id: "batch-new", branchId }),
      findOrCreateDefaultLocationForBranch: vi.fn().mockResolvedValue("loc-1"),
    };
    inventoryRepo = {
      findMedicineById: vi.fn(),
      updateMedicine: vi.fn(),
    };
    service = new BatchService(batchRepo, { log: vi.fn() } as any, inventoryRepo, {} as any);
  });

  const costOf = () => batchRepo.createBatch.mock.calls[0][0].costPrice;

  it("accepts a create payload with no costPrice at all", () => {
    const parsed = createBatchSchema.parse({ ...baseDto, branchId });
    expect(parsed.costPrice).toBeUndefined();
  });

  it("still rejects a malformed costPrice when one is sent", () => {
    expect(() => createBatchSchema.parse({ ...baseDto, costPrice: "abc" })).toThrow();
  });

  it("costs an omitted batch from the medicine's catalogue purchase rate", async () => {
    inventoryRepo.findMedicineById.mockResolvedValue({
      id: baseDto.medicineId,
      isActive: true,
      purchaseRate: "62.50",
      priceMrp: "100.00",
    });

    await service.create(baseDto as any, "user-1", branchId);

    expect(costOf()).toBe("62.50");
  });

  it("falls back to the batch MRP when the medicine has no purchase rate", async () => {
    inventoryRepo.findMedicineById.mockResolvedValue({
      id: baseDto.medicineId,
      isActive: true,
      purchaseRate: null,
      priceMrp: "100.00",
    });

    await service.create(baseDto as any, "user-1", branchId);

    // Not zero: a zero-cost row makes stock valuation under-report silently,
    // which is worse than a conservative over-estimate someone can correct.
    expect(costOf()).toBe("100.00");
  });

  it("never overrides a cost the operator actually typed", async () => {
    inventoryRepo.findMedicineById.mockResolvedValue({
      id: baseDto.medicineId,
      isActive: true,
      purchaseRate: "62.50",
      priceMrp: "100.00",
    });

    await service.create({ ...baseDto, costPrice: "41.00" } as any, "user-1", branchId);

    expect(costOf()).toBe("41.00");
  });
});

/**
 * The batches list is searchable. Without this a recall notice naming one
 * batch number meant paging through every batch in the branch to reach it.
 */
describe("queryBatchSchema — search", () => {
  it("accepts a free-text search term", () => {
    expect(queryBatchSchema.parse({ search: "crocin" }).search).toBe("crocin");
  });

  it("trims surrounding whitespace so a stray space is not a different query", () => {
    expect(queryBatchSchema.parse({ search: "  MF68843  " }).search).toBe("MF68843");
  });

  it("rejects a search that is only whitespace rather than matching everything", () => {
    expect(() => queryBatchSchema.parse({ search: "   " })).toThrow();
  });

  it("stays optional — an unfiltered list is still valid", () => {
    expect(queryBatchSchema.parse({}).search).toBeUndefined();
  });
});
