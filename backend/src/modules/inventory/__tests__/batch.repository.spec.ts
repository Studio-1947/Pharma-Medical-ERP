import { describe, it, expect, vi } from "vitest";
import { BatchRepository } from "../batch.repository";
import { UnprocessableEntityException } from "@nestjs/common";

// ─── Pure FEFO allocation helper (logic-only, no DB) ─────────────────────────

function allocateFefo(batches: { id: string; expiryDate: string; quantity: number }[], needed: number) {
  const sorted = [...batches].sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  const allocations: { batchId: string; allocate: number }[] = [];
  let remaining = needed;

  for (const batch of sorted) {
    if (remaining <= 0) break;
    const take = Math.min(batch.quantity, remaining);
    allocations.push({ batchId: batch.id, allocate: take });
    remaining -= take;
  }

  if (remaining > 0) {
    throw new Error(`Insufficient stock: requested ${needed}, available ${needed - remaining}`);
  }
  return allocations;
}

describe("BatchRepository (FEFO)", () => {
  describe("allocateFefo helper logic", () => {
    it("BILL-06: allocates from multiple batches in FEFO order", () => {
      const batches = [
        { id: "batch-2", expiryDate: "2026-09-01", quantity: 4 },
        { id: "batch-1", expiryDate: "2026-06-01", quantity: 6 },
      ];
      const result = allocateFefo(batches, 8);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ batchId: "batch-1", allocate: 6 });
      expect(result[1]).toEqual({ batchId: "batch-2", allocate: 2 });
    });

    it("allocates fully from a single batch when sufficient", () => {
      const batches = [{ id: "batch-1", expiryDate: "2026-06-01", quantity: 10 }];
      expect(allocateFefo(batches, 5)).toEqual([{ batchId: "batch-1", allocate: 5 }]);
    });

    it("throws when available stock is insufficient", () => {
      const batches = [{ id: "batch-1", expiryDate: "2026-06-01", quantity: 5 }];
      expect(() => allocateFefo(batches, 6)).toThrow(/Insufficient stock/);
    });

    it("handles multiple batches with same expiry — preserves original order", () => {
      const batches = [
        { id: "batch-a", expiryDate: "2026-06-01", quantity: 5 },
        { id: "batch-b", expiryDate: "2026-06-01", quantity: 5 },
      ];
      const result = allocateFefo(batches, 7);
      expect(result[0]).toEqual({ batchId: "batch-a", allocate: 5 });
      expect(result[1]).toEqual({ batchId: "batch-b", allocate: 2 });
    });

    it("allocating exactly zero needed returns empty list", () => {
      const batches = [{ id: "b1", expiryDate: "2026-06-01", quantity: 10 }];
      expect(allocateFefo(batches, 0)).toHaveLength(0);
    });
  });

  // ─── selectBatchesForDispense — tests against the real repository method ────

  describe("selectBatchesForDispense (repository method)", () => {
    function buildRepo(batchRows: any[]) {
      const mockDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(batchRows),
      };

      const drizzle = { db: mockDb };
      return new BatchRepository(drizzle as any);
    }

    it("returns allocations sorted FEFO (oldest expiry first)", async () => {
      const repo = buildRepo([
        { id: "batch-early", batchNo: "B01", expiryDate: "2026-04-01", quantity: 3, mrpAtEntry: "300.00" },
        { id: "batch-late",  batchNo: "B02", expiryDate: "2026-08-01", quantity: 10, mrpAtEntry: "300.00" },
      ]);

      const result = await repo.selectBatchesForDispense("med-1", 5);

      expect(result).toHaveLength(2);
      expect(result[0]!.batchId).toBe("batch-early");
      expect(result[0]!.allocate).toBe(3);
      expect(result[1]!.batchId).toBe("batch-late");
      expect(result[1]!.allocate).toBe(2);
    });

    it("returns a single allocation when one batch covers the full quantity", async () => {
      const repo = buildRepo([
        { id: "batch-1", batchNo: "B01", expiryDate: "2026-06-01", quantity: 20, mrpAtEntry: "200.00" },
      ]);

      const result = await repo.selectBatchesForDispense("med-1", 7);

      expect(result).toHaveLength(1);
      expect(result[0]!.allocate).toBe(7);
    });

    it("throws UnprocessableEntityException when stock is insufficient", async () => {
      const repo = buildRepo([
        { id: "batch-1", batchNo: "B01", expiryDate: "2026-06-01", quantity: 4, mrpAtEntry: "200.00" },
      ]);

      await expect(repo.selectBatchesForDispense("med-1", 10)).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it("throws when no batches available at all", async () => {
      const repo = buildRepo([]); // no active batches
      await expect(repo.selectBatchesForDispense("med-1", 1)).rejects.toThrow(
        /Insufficient stock/,
      );
    });

    it("allocates exactly the needed quantity across 3 batches", async () => {
      const repo = buildRepo([
        { id: "b1", batchNo: "B01", expiryDate: "2026-01-01", quantity: 5, mrpAtEntry: "100.00" },
        { id: "b2", batchNo: "B02", expiryDate: "2026-03-01", quantity: 5, mrpAtEntry: "100.00" },
        { id: "b3", batchNo: "B03", expiryDate: "2026-05-01", quantity: 5, mrpAtEntry: "100.00" },
      ]);

      const result = await repo.selectBatchesForDispense("med-1", 12);

      expect(result).toHaveLength(3);
      const totalAllocated = result.reduce((s, r) => s + r.allocate, 0);
      expect(totalAllocated).toBe(12);
      // Verify FEFO: earliest expiry fully consumed first
      expect(result[0]!.batchId).toBe("b1");
      expect(result[0]!.allocate).toBe(5);
    });

    it("uses the tx parameter instead of this.db when provided", async () => {
      const mainDb = {
        select: vi.fn(),
        from: vi.fn(),
        where: vi.fn(),
        orderBy: vi.fn(),
      };
      const drizzle = { db: mainDb };
      const repo = new BatchRepository(drizzle as any);

      const txDb = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue([
          { id: "batch-tx", batchNo: "TX01", expiryDate: "2026-06-01", quantity: 10, mrpAtEntry: "100.00" },
        ]),
      };

      const result = await repo.selectBatchesForDispense("med-1", 3, txDb);

      expect(txDb.select).toHaveBeenCalled();
      expect(mainDb.select).not.toHaveBeenCalled();
      expect(result[0]!.batchId).toBe("batch-tx");
    });
  });
});
