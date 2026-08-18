import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The offline queue marks a sale synced only once the POST resolves, so a
 * response lost after the server committed left the row pending and replayed
 * the identical payload on the next reconnect — billing the sale twice. It also
 * counted attempts without ever stopping, so a payload that could never succeed
 * retried on every reconnect for ever, silently.
 *
 * Dexie is stubbed with an in-memory table: these are tests of the queue's
 * decisions, not of IndexedDB.
 */

interface Row {
  id: number;
  localId: string;
  payload: any;
  createdAt: Date;
  synced: boolean;
  attempts: number;
  lastError?: string;
}

const rows: Row[] = [];
let nextId = 1;

vi.mock("dexie", () => {
  const table = () => ({
    add: async (r: Omit<Row, "id">) => {
      const row = { ...r, id: nextId++ } as Row;
      rows.push(row);
      return row.id;
    },
    update: async (id: number, patch: Partial<Row>) => {
      const row = rows.find((r) => r.id === id);
      if (row) Object.assign(row, patch);
      return row ? 1 : 0;
    },
    filter: (fn: (r: Row) => boolean) => ({
      toArray: async () => rows.filter(fn),
      count: async () => rows.filter(fn).length,
    }),
  });

  class FakeDexie {
    // Assigned from stores(), not the constructor: PosDatabase declares its
    // table fields, and those declarations run after super() and would
    // otherwise overwrite anything the base constructor had set.
    version() {
      const self = this as any;
      return {
        stores: (schema: Record<string, string>) => {
          for (const name of Object.keys(schema)) self[name] = table();
          return { upgrade: () => undefined };
        },
      };
    }
  }
  return { default: FakeDexie, Dexie: FakeDexie };
});

const { queueOfflineInvoice, syncOfflineQueue, getStuckInvoices, retryStuckInvoice, MAX_SYNC_ATTEMPTS } =
  await import("../pos-db");

beforeEach(() => {
  rows.length = 0;
  nextId = 1;
});

describe("queueOfflineInvoice", () => {
  it("attaches the local id to the payload as an idempotency key", async () => {
    const localId = await queueOfflineInvoice({ items: [], payments: [] });

    // Without this the server has no way to recognise a replay, which is
    // exactly how one sale became two invoices.
    expect(rows[0]!.payload.clientRef).toBe(localId);
  });

  it("keeps the rest of the payload intact", async () => {
    await queueOfflineInvoice({ patientId: "p-1", discountAmount: "0" });

    expect(rows[0]!.payload).toMatchObject({ patientId: "p-1", discountAmount: "0" });
  });

  it("gives each queued sale a distinct key", async () => {
    const a = await queueOfflineInvoice({});
    const b = await queueOfflineInvoice({});

    expect(a).not.toBe(b);
  });
});

describe("syncOfflineQueue", () => {
  it("marks a sale synced once the server accepts it", async () => {
    await queueOfflineInvoice({ n: 1 });

    const res = await syncOfflineQueue(async () => {});

    expect(res).toMatchObject({ synced: 1, failed: 0, abandoned: 0 });
    expect(rows[0]!.synced).toBe(true);
  });

  it("counts a failure and records why, without losing the sale", async () => {
    await queueOfflineInvoice({ n: 1 });

    const res = await syncOfflineQueue(async () => {
      throw new Error("Insufficient stock");
    });

    expect(res).toMatchObject({ synced: 0, failed: 1 });
    expect(rows[0]!.synced).toBe(false);
    expect(rows[0]!.attempts).toBe(1);
    expect(rows[0]!.lastError).toContain("Insufficient stock");
  });

  it("stops retrying after the attempt cap and reports it", async () => {
    await queueOfflineInvoice({ n: 1 });
    const fail = async () => { throw new Error("nope"); };

    for (let i = 0; i < MAX_SYNC_ATTEMPTS; i++) await syncOfflineQueue(fail);
    expect(rows[0]!.attempts).toBe(MAX_SYNC_ATTEMPTS);

    // The next pass must not touch it — silently retrying for ever is how a
    // failing sale stayed invisible.
    const submit = vi.fn(fail);
    const res = await syncOfflineQueue(submit);

    expect(submit).not.toHaveBeenCalled();
    expect(res.abandoned).toBe(1);
  });

  it("keeps going after one sale fails", async () => {
    await queueOfflineInvoice({ n: 1 });
    await queueOfflineInvoice({ n: 2 });

    let call = 0;
    const res = await syncOfflineQueue(async () => {
      call++;
      if (call === 1) throw new Error("first one failed");
    });

    expect(res).toMatchObject({ synced: 1, failed: 1 });
    expect(rows[1]!.synced).toBe(true);
  });

  it("ignores rows that are already synced", async () => {
    await queueOfflineInvoice({ n: 1 });
    rows[0]!.synced = true;

    const submit = vi.fn(async () => {});
    await syncOfflineQueue(submit);

    expect(submit).not.toHaveBeenCalled();
  });

  it("replays the stored payload verbatim, key included", async () => {
    const localId = await queueOfflineInvoice({ patientId: "p-9" });

    const submit = vi.fn(async () => {});
    await syncOfflineQueue(submit);

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: "p-9", clientRef: localId }),
    );
  });
});

describe("stuck sales", () => {
  it("lists the ones that exhausted their retries", async () => {
    await queueOfflineInvoice({ n: 1 });
    rows[0]!.attempts = MAX_SYNC_ATTEMPTS;

    expect(await getStuckInvoices()).toHaveLength(1);
  });

  it("can be put back in the queue once the cause is fixed", async () => {
    await queueOfflineInvoice({ n: 1 });
    rows[0]!.attempts = MAX_SYNC_ATTEMPTS;

    await retryStuckInvoice(rows[0]!.id);

    expect(rows[0]!.attempts).toBe(0);
    const submit = vi.fn(async () => {});
    await syncOfflineQueue(submit);
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
