import { describe, it, expect, vi } from "vitest";
import { BillingRepository } from "../billing.repository";

/**
 * The invoice serial used to come from a Redis INCR outside the transaction.
 * Two things followed, both of them costly and neither recoverable:
 *
 *  - Lose the key and the counter restarts at 1, re-issuing numbers already
 *    used that day. The unique index then rejects the insert, so billing stops
 *    at the counter until the date rolls over.
 *  - The number was handed out before the invoice was written, and Redis takes
 *    no part in a Postgres transaction, so any later failure consumed a number
 *    that nothing recorded. Rule 46 requires the series to be consecutive and
 *    those gaps could not be explained afterwards.
 *
 * It is now an upsert on invoice_sequences inside the caller's transaction.
 */

function buildTx(lastSeq: number, branchCode = "BRN02") {
  const insertChain: any = {
    values: vi.fn(() => insertChain),
    onConflictDoUpdate: vi.fn(() => insertChain),
    returning: vi.fn().mockResolvedValue([{ lastSeq }]),
  };
  const selectChain: any = {
    from: vi.fn(() => selectChain),
    where: vi.fn(() => selectChain),
    limit: vi.fn().mockResolvedValue([{ code: branchCode }]),
  };
  return {
    tx: {
      insert: vi.fn(() => insertChain),
      select: vi.fn(() => selectChain),
    } as any,
    insertChain,
    selectChain,
  };
}

const repo = new BillingRepository({} as any);

describe("nextInvoiceNumber", () => {
  it("formats as BRANCHCODE-YYYYMMDD-NNNNN", async () => {
    const { tx } = buildTx(42);
    const today = new Date().toISOString().split("T")[0]!.replace(/-/g, "");

    const no = await repo.nextInvoiceNumber("branch-1", tx);

    expect(no).toBe(`BRN02-${today}-00042`);
  });

  it("pads the sequence to five digits", async () => {
    const { tx } = buildTx(7);
    expect(await repo.nextInvoiceNumber("branch-1", tx)).toMatch(/-00007$/);
  });

  it("does not truncate a sequence past five digits", async () => {
    const { tx } = buildTx(123456);
    expect(await repo.nextInvoiceNumber("branch-1", tx)).toMatch(/-123456$/);
  });

  it("upper-cases the branch code", async () => {
    const { tx } = buildTx(1, "brn07");
    expect(await repo.nextInvoiceNumber("branch-1", tx)).toMatch(/^BRN07-/);
  });

  it("falls back to BRN01 when the branch has no code", async () => {
    const { tx, selectChain } = buildTx(1);
    selectChain.limit.mockResolvedValue([]);
    expect(await repo.nextInvoiceNumber("branch-1", tx)).toMatch(/^BRN01-/);
  });

  it("allocates through the caller's transaction, not a separate connection", async () => {
    const { tx, insertChain } = buildTx(3);

    await repo.nextInvoiceNumber("branch-1", tx);

    // If this ran off `this.db` the number would survive a rollback and leave
    // a permanent gap in the series.
    expect(tx.insert).toHaveBeenCalledTimes(1);
    expect(insertChain.onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });

  it("keys the counter by branch and date", async () => {
    const { tx, insertChain } = buildTx(1);
    const today = new Date().toISOString().split("T")[0]!;

    await repo.nextInvoiceNumber("branch-9", tx);

    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: "branch-9", seqDate: today, lastSeq: 1 }),
    );
  });

  it("refuses to run outside a transaction", async () => {
    await expect(repo.nextInvoiceNumber("branch-1", undefined as any)).rejects.toThrow(
      /inside the transaction/,
    );
  });

  it("refuses to allocate without a branch", async () => {
    const { tx } = buildTx(1);
    await expect(repo.nextInvoiceNumber("", tx)).rejects.toThrow(/branchId is required/);
  });
});
