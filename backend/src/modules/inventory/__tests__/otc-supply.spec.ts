import { describe, it, expect, vi } from "vitest";
import { NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { BatchService } from "../batch.service";
import { StockMovementRepository } from "../stock-movement.repository";
import { otcSupplyBatchSchema } from "@pharmerp/types";

/**
 * OTC supply — medicine handed over from the counter WITHOUT an invoice.
 * Stock is decremented atomically and an `otc_supply` ledger movement is
 * logged so the hand-out stays traceable. Used by both the classic POS
 * ("OTC · No bill" button) and the patient-first counter desk.
 */
describe("BatchService.recordOtcSupply", () => {
  function buildService(batch?: any, adjustResult?: any) {
    const batchRepo = {
      findBatchById: vi.fn().mockResolvedValue(batch ?? null),
      adjustQuantity: vi.fn().mockResolvedValue(adjustResult),
    };
    const movementRepo = { log: vi.fn().mockResolvedValue({ id: "mv-1" }) };
    const inventoryRepo = {};
    const barcodeService = {};
    const service = new BatchService(
      batchRepo as any,
      movementRepo as any,
      inventoryRepo as any,
      barcodeService as any,
    );
    return { service, batchRepo, movementRepo };
  }

  /** Shop manager at the batch's own branch — passes the ownership guard. */
  const counterStaff = {
    sub: "user-1",
    role: "shop_manager",
    branchId: "branch-1",
  } as any;

  const activeBatch = {
    id: "batch-1",
    batchNo: "BAT-001",
    medicineId: "med-1",
    branchId: "branch-1",
    quantity: 27,
  };

  it("decrements the batch and logs an otc_supply movement", async () => {
    const { service, batchRepo, movementRepo } = buildService(
      activeBatch,
      { id: "batch-1", quantity: 26 },
    );

    const result = await service.recordOtcSupply("batch-1", { quantity: 1, notes: "free sample" }, counterStaff);

    expect(batchRepo.adjustQuantity).toHaveBeenCalledWith("batch-1", -1);
    expect(movementRepo.log).toHaveBeenCalledWith({
      batchId: "batch-1",
      medicineId: "med-1",
      branchId: "branch-1",
      movementType: "otc_supply",
      quantity: -1,
      performedBy: "user-1",
      notes: "free sample",
    });
    expect(result.data).toEqual({
      batchId: "batch-1",
      batchNo: "BAT-001",
      quantitySupplied: 1,
      remainingQuantity: 26,
    });
    expect(result.message).toContain("no bill");
  });

  it("throws NotFound when the batch does not exist", async () => {
    const { service } = buildService(undefined);
    await expect(service.recordOtcSupply("missing", { quantity: 1 }, counterStaff)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("rejects a quantity above the batch's available stock (422)", async () => {
    const { service } = buildService(activeBatch);
    await expect(
      service.recordOtcSupply("batch-1", { quantity: 999 }, counterStaff),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it("rejects when the atomic stock guard blocks the decrement (422)", async () => {
    // adjustQuantity returns undefined when the WHERE guard prevents going negative
    const { service, movementRepo } = buildService(activeBatch, undefined);
    await expect(
      service.recordOtcSupply("batch-1", { quantity: 1 }, counterStaff),
    ).rejects.toThrow(UnprocessableEntityException);
    expect(movementRepo.log).not.toHaveBeenCalled();
  });

  it("defaults notes when none are provided", async () => {
    const { service, movementRepo } = buildService(activeBatch, { id: "batch-1", quantity: 26 });
    await service.recordOtcSupply("batch-1", { quantity: 1 }, counterStaff);
    expect(movementRepo.log).toHaveBeenCalledWith(
      expect.objectContaining({ notes: "OTC supply without billing" }),
    );
  });
});

describe("StockMovementRepository.findOtcSupplies", () => {
  function buildRepo(summaryRow: any, records: any[]) {
    // Two independent query chains: the summary (select/from/where) and the
    // record list (select/from/leftJoin x3/where/orderBy/limit). Promise.all
    // awaits the last object in each chain, so each chain ends in a thenable.
    const summaryChain = { then: (ok: any) => Promise.resolve([summaryRow]).then(ok) };
    const recordsChain = { then: (ok: any) => Promise.resolve(records).then(ok) };
    const db = {
      select: vi
        .fn()
        .mockImplementationOnce(() => ({ from: () => ({ where: () => summaryChain }) }))
        .mockImplementationOnce(() => ({
          from: () => ({
            leftJoin: () => ({
              leftJoin: () => ({
                leftJoin: () => ({
                  where: () => ({ orderBy: () => ({ limit: () => recordsChain }) }),
                }),
              }),
            }),
          }),
        })),
    };
    return { repo: new StockMovementRepository({ db } as any), db };
  }

  it("summarises the day's supplies (count + units) and returns records", async () => {
    const { repo } = buildRepo(
      { count: 2, units: 3 },
      [
        {
          id: "m1",
          medicineId: "med-1",
          medicineName: "Paracetamol 500mg",
          batchNo: "BAT-001",
          quantity: -2,
          notes: "sample",
          createdAt: new Date().toISOString(),
        },
      ],
    );

    const result = await repo.findOtcSupplies("2026-08-14", "branch-1");

    expect(result.supplies).toBe(2);
    expect(result.units).toBe(3);
    expect(result.records).toHaveLength(1);
    // Each stored row is negative; the API surfaces the positive count.
    expect(result.records[0]!.quantity).toBe(2);
    expect(result.records[0]!.medicineName).toBe("Paracetamol 500mg");
  });

  it("returns zeroes when the day has no supplies", async () => {
    const { repo } = buildRepo({ count: 0, units: 0 }, []);
    const result = await repo.findOtcSupplies("2026-01-01");
    expect(result.supplies).toBe(0);
    expect(result.units).toBe(0);
    expect(result.records).toHaveLength(0);
  });
});

describe("otcSupplyBatchSchema (zod)", () => {
  it("accepts a valid payload", () => {
    const parsed = otcSupplyBatchSchema.parse({ quantity: 2, notes: "staff medicine" });
    expect(parsed.quantity).toBe(2);
  });

  it("rejects zero or negative quantities", () => {
    expect(() => otcSupplyBatchSchema.parse({ quantity: 0 })).toThrow();
    expect(() => otcSupplyBatchSchema.parse({ quantity: -3 })).toThrow();
  });

  it("rejects notes longer than 300 chars", () => {
    expect(() =>
      otcSupplyBatchSchema.parse({ quantity: 1, notes: "x".repeat(301) }),
    ).toThrow();
  });

  it("rejects a malformed branchId", () => {
    expect(() =>
      otcSupplyBatchSchema.parse({ quantity: 1, branchId: "not-a-uuid" }),
    ).toThrow();
  });
});
