import { describe, it, expect, vi } from "vitest";
import { BillingRepository } from "../billing.repository";

/**
 * Every printed medicine bill -- POS receipt, on-screen preview, invoice PDF
 * and the public share page -- takes its shop name, address and phone from the
 * selling branch. This repository call is the single place that reads them, so
 * if it stops returning a row, every one of those documents silently falls back
 * to the built-in store name and Store 2's customers get Store 1's identity on
 * a tax invoice.
 */
describe("BillingRepository.findBranchPrintDetails", () => {
  function buildRepo(rows: any[]) {
    const repo = new BillingRepository({} as any);
    const limit = vi.fn().mockResolvedValue(rows);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    // The repository reads `this.drizzle.db` through a getter, so the fake db
    // is installed on the injected service rather than on the repo itself.
    (repo as any).drizzle = { db: { select } };
    return { repo, select, limit };
  }

  it("returns the branch's own printed identity", async () => {
    const { repo } = buildRepo([
      {
        id: "b-2",
        name: "Radha Madhav Medical Hall and Polyclinic",
        address: "Store 2 address",
        phone: "99999 00000",
      },
    ]);

    await expect(repo.findBranchPrintDetails("b-2")).resolves.toMatchObject({
      name: "Radha Madhav Medical Hall and Polyclinic",
      address: "Store 2 address",
      phone: "99999 00000",
    });
  });

  it("returns null when the branch row is gone, so the caller can fall back", async () => {
    const { repo } = buildRepo([]);
    await expect(repo.findBranchPrintDetails("b-missing")).resolves.toBeNull();
  });

  it("skips the query entirely for an invoice with no branch", async () => {
    const { repo, select } = buildRepo([]);

    await expect(repo.findBranchPrintDetails(null)).resolves.toBeNull();
    await expect(repo.findBranchPrintDetails(undefined)).resolves.toBeNull();
    expect(select).not.toHaveBeenCalled();
  });

  it("asks for one row only", async () => {
    const { repo, limit } = buildRepo([{ id: "b-1", name: "A", address: "B", phone: "C" }]);
    await repo.findBranchPrintDetails("b-1");
    expect(limit).toHaveBeenCalledWith(1);
  });
});
