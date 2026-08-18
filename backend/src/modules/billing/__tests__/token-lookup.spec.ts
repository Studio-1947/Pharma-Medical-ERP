import { describe, it, expect, vi } from "vitest";
import { BillingRepository } from "../billing.repository";

/**
 * Most sales are walk-ins with no prescription, so findTokenNoByPrescription is
 * called with null on the majority of invoices. The early return keeps that off
 * the database entirely; without it every counter sale would run a pointless
 * query on the clinic queue table.
 */
describe("BillingRepository.findTokenNoByPrescription", () => {
  function buildRepo(findFirst: any) {
    const repo = new BillingRepository({} as any);
    // The repository reads `this.drizzle.db` through a getter, so the fake db is
    // installed on the injected service rather than on the repo itself.
    (repo as any).drizzle = {
      db: { query: { clinicTokens: { findFirst } } },
    };
    return repo;
  }

  it("returns the token number for a prescription that came from the queue", async () => {
    const findFirst = vi.fn().mockResolvedValue({ tokenNo: 9 });
    const repo = buildRepo(findFirst);

    await expect(repo.findTokenNoByPrescription("rx-1")).resolves.toBe(9);
    expect(findFirst).toHaveBeenCalledOnce();
  });

  it("returns null when the prescription has no queue token", async () => {
    const findFirst = vi.fn().mockResolvedValue(undefined);
    const repo = buildRepo(findFirst);

    await expect(repo.findTokenNoByPrescription("rx-unknown")).resolves.toBeNull();
  });

  it("short-circuits without querying when there is no prescription", async () => {
    const findFirst = vi.fn(() => {
      throw new Error("database must not be queried for a walk-in sale");
    });
    const repo = buildRepo(findFirst);

    await expect(repo.findTokenNoByPrescription(null)).resolves.toBeNull();
    await expect(repo.findTokenNoByPrescription(undefined)).resolves.toBeNull();
    await expect(repo.findTokenNoByPrescription("")).resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });
});
