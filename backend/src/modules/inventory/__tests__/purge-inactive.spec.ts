import { describe, it, expect, vi, beforeEach } from "vitest";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { InventoryService } from "../inventory.service";
import { purgeInactiveMedicinesSchema } from "@pharmerp/types";

/**
 * The purge deletes catalogue rows outright, so the guards around it matter
 * more than the delete itself. Two things must hold: previewing must never
 * write, and a preview the operator has already seen must not be able to
 * authorise deleting a different number of rows than it displayed.
 */
describe("InventoryService.purgeInactive", () => {
  let service: InventoryService;
  let repo: any;

  const preview = {
    candidates: 26_000,
    deletable: 25_800,
    blocked: 200,
    blockedBy: [{ label: "stock batches", count: 200 }],
    sideEffects: { prescriptionLinksCleared: 0, doctorFavouritesRemoved: 3 },
    sample: [],
  };

  beforeEach(() => {
    repo = {
      previewInactivePurge: vi.fn().mockResolvedValue(preview),
      purgeInactiveMedicines: vi
        .fn()
        .mockResolvedValue({ deleted: 25_800, actual: 25_800, mismatch: false }),
    };
    service = new InventoryService(repo);
  });

  it("defaults to a preview when dryRun is not specified", () => {
    // The safe default lives in the schema, so assert it there rather than
    // trusting every caller to pass the flag.
    expect(purgeInactiveMedicinesSchema.parse({}).dryRun).toBe(true);
  });

  it("previewing never touches the delete path", async () => {
    const res = await service.purgeInactive({ dryRun: true });
    expect(repo.purgeInactiveMedicines).not.toHaveBeenCalled();
    expect(res.deleted).toBe(0);
    expect(res.dryRun).toBe(true);
    expect(res.deletable).toBe(25_800);
  });

  it("reports what is held back and what the delete will touch silently", async () => {
    const res = await service.purgeInactive({ dryRun: true });
    expect(res.blocked).toBe(200);
    expect(res.blockedBy).toEqual([{ label: "stock batches", count: 200 }]);
    expect(res.sideEffects.doctorFavouritesRemoved).toBe(3);
  });

  it("refuses to delete without an expected count", async () => {
    await expect(service.purgeInactive({ dryRun: false })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.purgeInactiveMedicines).not.toHaveBeenCalled();
  });

  it("deletes when the echoed count matches what was previewed", async () => {
    const res = await service.purgeInactive({ dryRun: false, expectedCount: 25_800 });
    expect(repo.purgeInactiveMedicines).toHaveBeenCalledWith(undefined, 25_800);
    expect(res.deleted).toBe(25_800);
  });

  it("deletes nothing when the catalogue moved under a stale preview", async () => {
    // A tab left open while someone else imported or edited. The repository
    // re-counts inside the delete transaction and reports the mismatch rather
    // than deleting the new, larger set.
    repo.purgeInactiveMedicines.mockResolvedValue({
      deleted: 0,
      actual: 31_000,
      mismatch: true,
    });
    await expect(
      service.purgeInactive({ dryRun: false, expectedCount: 25_800 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("passes the createdAfter window through to the repository", async () => {
    const when = new Date("2026-08-20T00:00:00Z");
    await service.purgeInactive({ dryRun: false, createdAfter: when, expectedCount: 25_800 });
    expect(repo.purgeInactiveMedicines).toHaveBeenCalledWith(when, 25_800);
  });

  it("coerces createdAfter from a plain date string", () => {
    const dto = purgeInactiveMedicinesSchema.parse({ createdAfter: "2026-08-20" });
    expect(dto.createdAfter).toBeInstanceOf(Date);
  });
});
