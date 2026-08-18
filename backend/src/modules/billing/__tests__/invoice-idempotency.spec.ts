import { describe, it, expect, vi, beforeEach } from "vitest";
import { BillingService } from "../billing.service";

/**
 * The offline POS marks a queued sale synced only once the POST resolves. A
 * response lost after the server committed — dropped connection, timeout, tab
 * closed mid-flight — therefore left the row pending and replayed the identical
 * payload on the next reconnect: a second invoice, a second stock deduction and
 * a second loyalty accrual for one sale.
 *
 * `clientRef` closes it. These tests cover both the ordinary replay and the
 * case where two replays arrive at once and only the unique index separates
 * them.
 */

function buildService() {
  const repo: any = {
    findByClientRef: vi.fn().mockResolvedValue(undefined),
    findTokenNoByPrescription: vi.fn().mockResolvedValue(7),
  };
  const drizzle: any = { db: { transaction: vi.fn() } };

  const service = new BillingService(
    repo,
    drizzle,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  // The transaction body is exercised in pos-checkout.spec; here only the
  // wrapper's dedupe behaviour is under test.
  const runTx = vi.fn();
  (service as any).createInTransaction = runTx;

  return { service, repo, runTx };
}

const dto = (clientRef?: string) => ({
  items: [{ medicineId: "med-1", quantity: 1, discountPct: "0" }],
  payments: [{ mode: "cash", amount: "100.00" }],
  ...(clientRef ? { clientRef } : {}),
}) as any;

const existing = {
  id: "inv-1",
  invoiceNo: "BRN01-20260818-00001",
  prescriptionId: "rx-1",
  items: [{ id: "line-1" }],
};

describe("a replayed checkout returns the original invoice", () => {
  let h: ReturnType<typeof buildService>;
  beforeEach(() => { h = buildService(); });

  it("does not write a second sale when the key has been seen", async () => {
    h.repo.findByClientRef.mockResolvedValue(existing);

    const res: any = await h.service.create(dto("TMP-123-ABCDE"), "staff-1", "branch-1");

    expect(h.runTx).not.toHaveBeenCalled();
    expect(res.invoice.id).toBe("inv-1");
    expect(res.items).toEqual([{ id: "line-1" }]);
  });

  it("flags the response so the counter can tell a replay from a new sale", async () => {
    h.repo.findByClientRef.mockResolvedValue(existing);

    const res: any = await h.service.create(dto("TMP-123-ABCDE"), "staff-1", "branch-1");

    expect(res.deduplicated).toBe(true);
  });

  it("still carries the queue token, so the receipt reprints correctly", async () => {
    h.repo.findByClientRef.mockResolvedValue(existing);

    const res: any = await h.service.create(dto("TMP-123-ABCDE"), "staff-1", "branch-1");

    expect(res.invoice.tokenNo).toBe(7);
  });

  it("proceeds normally the first time a key is seen", async () => {
    h.repo.findByClientRef.mockResolvedValue(undefined);
    h.runTx.mockResolvedValue({ invoice: { id: "new-1" }, items: [] });

    const res: any = await h.service.create(dto("TMP-123-ABCDE"), "staff-1", "branch-1");

    expect(h.runTx).toHaveBeenCalledTimes(1);
    expect(res.invoice.id).toBe("new-1");
    expect(res.deduplicated).toBeUndefined();
  });

  it("skips the lookup entirely when no key is sent", async () => {
    h.runTx.mockResolvedValue({ invoice: { id: "new-1" }, items: [] });

    await h.service.create(dto(), "staff-1", "branch-1");

    expect(h.repo.findByClientRef).not.toHaveBeenCalled();
    expect(h.runTx).toHaveBeenCalledTimes(1);
  });
});

describe("two replays arriving at once", () => {
  it("treats losing the unique-index race as success, not an error", async () => {
    const h = buildService();
    // Both requests pass the pre-check; the index decides.
    h.repo.findByClientRef.mockResolvedValueOnce(undefined).mockResolvedValueOnce(existing);
    h.runTx.mockRejectedValue(Object.assign(new Error("duplicate key"), { code: "23505" }));

    const res: any = await h.service.create(dto("TMP-123-ABCDE"), "staff-1", "branch-1");

    expect(res.invoice.id).toBe("inv-1");
    expect(res.deduplicated).toBe(true);
  });

  it("reads the code through `cause` when the driver wraps the error", async () => {
    const h = buildService();
    h.repo.findByClientRef.mockResolvedValueOnce(undefined).mockResolvedValueOnce(existing);
    h.runTx.mockRejectedValue(
      Object.assign(new Error("insert failed"), { cause: { code: "23505" } }),
    );

    const res: any = await h.service.create(dto("TMP-123-ABCDE"), "staff-1", "branch-1");
    expect(res.deduplicated).toBe(true);
  });

  it("rethrows a unique violation that is not the client key", async () => {
    const h = buildService();
    // No clientRef: a 23505 here is a genuine collision, such as an invoice
    // number clash, and must not be swallowed.
    h.runTx.mockRejectedValue(Object.assign(new Error("duplicate key"), { code: "23505" }));

    await expect(h.service.create(dto(), "staff-1", "branch-1")).rejects.toThrow("duplicate key");
  });

  it("rethrows when the key collided but no invoice can be found", async () => {
    const h = buildService();
    h.repo.findByClientRef.mockResolvedValue(undefined);
    h.runTx.mockRejectedValue(Object.assign(new Error("duplicate key"), { code: "23505" }));

    await expect(
      h.service.create(dto("TMP-123-ABCDE"), "staff-1", "branch-1"),
    ).rejects.toThrow("duplicate key");
  });

  it("does not swallow unrelated failures", async () => {
    const h = buildService();
    h.runTx.mockRejectedValue(new Error("Insufficient stock for medicine med-1"));

    await expect(
      h.service.create(dto("TMP-123-ABCDE"), "staff-1", "branch-1"),
    ).rejects.toThrow(/Insufficient stock/);
  });
});
