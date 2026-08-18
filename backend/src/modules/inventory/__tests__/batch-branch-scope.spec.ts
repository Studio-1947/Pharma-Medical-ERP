import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { BatchService } from "../batch.service";

/**
 * Batch routes take a bare UUID and a batch id is not a secret — list endpoints
 * return it and barcode labels print it. Until this guard existed, every by-id
 * batch route was reachable across branches: read another branch's cost prices,
 * and write too — adjust its quantity, quarantine or recall it, reserve it,
 * delete it. Every other module already scoped; inventory batches were the one
 * gap.
 *
 * Each write path is covered separately rather than testing the helper once,
 * because the defect was never the check itself — it was a method not calling it.
 */

const OTHER_BRANCH_BATCH = {
  id: "batch-x",
  batchNo: "BAT-X",
  medicineId: "med-1",
  branchId: "branch-2",
  quantity: 50,
};

const OWN_BRANCH_BATCH = { ...OTHER_BRANCH_BATCH, id: "batch-1", branchId: "branch-1" };

/** Shop manager pinned to branch-1. */
const intruder = { sub: "u-1", role: "shop_manager", branchId: "branch-1" } as any;
/** Unscoped operator: allowed everywhere by design. */
const superAdmin = { sub: "u-0", role: "super_admin", branchId: null } as any;

function buildService(batch: any) {
  const batchRepo = {
    findBatchById: vi.fn().mockResolvedValue(batch),
    findBatches: vi.fn().mockResolvedValue({ data: [], meta: {} }),
    updateBatch: vi.fn().mockResolvedValue({ id: batch?.id }),
    updateBatchStatus: vi.fn().mockResolvedValue({ id: batch?.id }),
    adjustQuantity: vi.fn().mockResolvedValue({ id: batch?.id, quantity: 49 }),
    reserveStock: vi.fn().mockResolvedValue({ id: batch?.id }),
    releaseStock: vi.fn().mockResolvedValue({ id: batch?.id }),
    hasMovements: vi.fn().mockResolvedValue(false),
    deleteBatch: vi.fn().mockResolvedValue(undefined),
  };
  const movementRepo = { log: vi.fn().mockResolvedValue({}), findByBatch: vi.fn().mockResolvedValue([]) };
  const barcodeService = { generateRaw: vi.fn().mockResolvedValue(Buffer.from("png")) };
  const service = new BatchService(
    batchRepo as any,
    movementRepo as any,
    {} as any,
    barcodeService as any,
  );
  return { service, batchRepo, movementRepo };
}

/** Every by-id entry point, with arguments valid enough to reach the guard. */
const routes: Array<[string, (s: BatchService, user: any) => Promise<unknown>]> = [
  ["findOne",         (s, u) => s.findOne("batch-x", u)],
  ["getMovements",    (s, u) => s.getMovements("batch-x", u)],
  ["getBarcodeLabel", (s, u) => s.getBarcodeLabel("batch-x", u)],
  ["update",          (s, u) => s.update("batch-x", { mrpAtEntry: "1.00" } as any, u)],
  ["updateStatus",    (s, u) => s.updateStatus("batch-x", { status: "recalled" } as any, u)],
  ["adjust",          (s, u) => s.adjust("batch-x", { adjustment: -5, notes: "shrinkage" } as any, u)],
  ["recordOtcSupply", (s, u) => s.recordOtcSupply("batch-x", { quantity: 1 } as any, u)],
  ["remove",          (s, u) => s.remove("batch-x", u)],
  ["reserveStock",    (s, u) => s.reserveStock("batch-x", 1, u)],
  ["releaseStock",    (s, u) => s.releaseStock("batch-x", 1, u)],
];

describe("batch routes refuse another branch's stock", () => {
  it.each(routes)("%s", async (_name, call) => {
    const { service } = buildService(OTHER_BRANCH_BATCH);
    await expect(call(service, intruder)).rejects.toThrow(ForbiddenException);
  });

  it("writes nothing when the guard refuses", async () => {
    const { service, batchRepo, movementRepo } = buildService(OTHER_BRANCH_BATCH);

    await expect(
      service.adjust("batch-x", { adjustment: -50, notes: "theft" } as any, intruder),
    ).rejects.toThrow(ForbiddenException);

    expect(batchRepo.adjustQuantity).not.toHaveBeenCalled();
    expect(movementRepo.log).not.toHaveBeenCalled();
  });

  it("refuses a recall on another branch's batch before any movement is logged", async () => {
    const { service, batchRepo, movementRepo } = buildService(OTHER_BRANCH_BATCH);

    await expect(
      service.updateStatus("batch-x", { status: "recalled" } as any, intruder),
    ).rejects.toThrow(ForbiddenException);

    expect(batchRepo.updateBatchStatus).not.toHaveBeenCalled();
    expect(movementRepo.log).not.toHaveBeenCalled();
  });
});

describe("batch routes still serve the owning branch", () => {
  it.each(routes)("%s", async (_name, call) => {
    const { service } = buildService({ ...OWN_BRANCH_BATCH, id: "batch-x" });
    await expect(call(service, intruder)).resolves.toBeDefined();
  });

  it("lets super_admin reach any branch", async () => {
    const { service } = buildService(OTHER_BRANCH_BATCH);
    await expect(service.findOne("batch-x", superAdmin)).resolves.toBeDefined();
  });

  it("reports a missing batch as not-found, not forbidden", async () => {
    const { service } = buildService(undefined);
    await expect(service.findOne("nope", intruder)).rejects.toThrow(NotFoundException);
  });
});

describe("the batch list is scoped", () => {
  it("passes the resolved branch through to the query", async () => {
    const { service, batchRepo } = buildService(OWN_BRANCH_BATCH);

    await service.findAll({ page: 1, limit: 20, branchId: "branch-1" } as any);

    expect(batchRepo.findBatches).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: "branch-1" }),
    );
  });
});
