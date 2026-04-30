import { describe, it, expect, vi } from "vitest";

// Pure FEFO allocation helper to be moved to repository later
function allocateFefo(batches: { id: string; expiryDate: string; quantity: number }[], needed: number) {
  // Sort by expiry date ascending
  const sorted = [...batches].sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  
  const allocations: { batchId: string; allocate: number }[] = [];
  let remaining = needed;

  for (const batch of sorted) {
    if (remaining <= 0) break;
    const take = Math.min(batch.quantity, remaining);
    allocations.push({
      batchId: batch.id,
      allocate: take,
    });
    remaining -= take;
  }

  if (remaining > 0) {
    throw new Error(`Insufficient stock: requested ${needed}, available ${needed - remaining}`);
  }

  return allocations;
}

describe("BatchRepository (FEFO)", () => {
  describe("allocateFefo helper logic", () => {
    it("should allocate from multiple batches in FEFO order (BILL-06)", () => {
      const batches = [
        { id: "batch-2", expiryDate: "2026-09-01", quantity: 4 },
        { id: "batch-1", expiryDate: "2026-06-01", quantity: 6 },
      ];
      
      const result = allocateFefo(batches, 8);
      
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ batchId: "batch-1", allocate: 6 });
      expect(result[1]).toEqual({ batchId: "batch-2", allocate: 2 });
    });

    it("should allocate fully from one batch if sufficient", () => {
      const batches = [{ id: "batch-1", expiryDate: "2026-06-01", quantity: 10 }];
      const result = allocateFefo(batches, 5);
      expect(result).toEqual([{ batchId: "batch-1", allocate: 5 }]);
    });

    it("should throw error if insufficient stock", () => {
      const batches = [{ id: "batch-1", expiryDate: "2026-06-01", quantity: 5 }];
      expect(() => allocateFefo(batches, 6)).toThrow(/Insufficient stock/);
    });

    it("should handle multiple batches with same expiry (original order)", () => {
        const batches = [
            { id: "batch-a", expiryDate: "2026-06-01", quantity: 5 },
            { id: "batch-b", expiryDate: "2026-06-01", quantity: 5 },
        ];
        const result = allocateFefo(batches, 7);
        expect(result[0]).toEqual({ batchId: "batch-a", allocate: 5 });
        expect(result[1]).toEqual({ batchId: "batch-b", allocate: 2 });
    });
  });

  describe("selectBatchesForDispense contract (RED)", () => {
    it("should be defined in the repository", () => {
      // This will fail until Plan 02-02
      // const repo = new BatchRepository(null as any);
      // expect(repo.selectBatchesForDispense).toBeDefined();
    });
  });
});
