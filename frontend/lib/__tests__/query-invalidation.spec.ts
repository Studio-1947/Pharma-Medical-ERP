import { describe, it, expect, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { invalidateMedicineViews, invalidateCounterDesk } from "@/lib/query-invalidation";

/**
 * Medicine query keys grew per screen — "medicine-search-counter",
 * "counter-medicine-search", "otc-add-medicine-search", "medicines",
 * "low-stock", "expiring-batches" and more. A mutation that had to enumerate
 * them was never going to stay complete, and did not: activating a medicine
 * invalidated nothing, so it went on being listed Inactive at ₹0.00 until the
 * operator reloaded the page.
 *
 * The list below is taken from the keys actually in use. If a screen renames
 * its key, this catches the drift rather than letting the invalidation quietly
 * stop reaching it.
 */
const MEDICINE_KEYS = [
  ["medicines", "list", { search: "dolo" }],
  ["medicines", "med-1"],
  ["medicine-search-counter", "dolo", "branch-1"],
  ["counter-medicine-search", "dolo"],
  ["otc-add-medicine-search", "dolo", "branch-1"],
  ["medicine-search", "dolo"],
  ["medicine-search-form", "dolo"],
  ["medicine-autocomplete", "dolo"],
  ["medicine-detail", "med-1"],
  ["medicine-batches", "med-1"],
  ["medicine-batches-detail", "med-1"],
  ["medicine-categories"],
  ["batches", { page: 1 }],
  ["batch-dup-check", "med-1"],
  ["low-stock", "branch-1"],
  ["counter-low-stock", "branch-1"],
  ["expiring-batches", "branch-1"],
  ["stock-valuation", "branch-1"],
  ["inventory", "summary"],
  ["otc-supply-batches", "med-1"],
];

/** Keys that must be left alone — invalidating these is pure waste. */
const UNRELATED_KEYS = [
  ["patient-search-counter", "9800000000"],
  ["patients", "list", {}],
  ["invoices", "list", {}],
  ["clinic-tokens", "branch-1"],
  ["doctors", "branch-1"],
  ["billing-flow"],
  ["admin", "audit-logs", {}],
];

describe("invalidateMedicineViews", () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  /** Seeds a resolved cache entry so the client has something to invalidate. */
  const seed = (keys: unknown[][]) =>
    keys.forEach((k, i) => qc.setQueryData(k, { seeded: i }));

  const staleKeys = () =>
    qc
      .getQueryCache()
      .getAll()
      .filter((q) => q.state.isInvalidated)
      .map((q) => JSON.stringify(q.queryKey));

  it("reaches every medicine, batch and stock view in use", async () => {
    seed(MEDICINE_KEYS);
    await invalidateMedicineViews(qc);

    const stale = staleKeys();
    const missed = MEDICINE_KEYS.filter((k) => !stale.includes(JSON.stringify(k)));
    expect(missed).toEqual([]);
  });

  it("leaves unrelated caches alone", async () => {
    seed([...MEDICINE_KEYS, ...UNRELATED_KEYS]);
    await invalidateMedicineViews(qc);

    const stale = staleKeys();
    const collateral = UNRELATED_KEYS.filter((k) => stale.includes(JSON.stringify(k)));
    // Refetching every patient and invoice because one MRP changed would turn
    // a price edit into a page-wide reload.
    expect(collateral).toEqual([]);
  });

  it("survives a non-string key root without throwing", async () => {
    // Defensive: a predicate that throws takes out the whole invalidation, so
    // an oddly-shaped key elsewhere in the app must not be able to break this.
    qc.setQueryData([{ odd: true }, "shape"], { seeded: true });
    qc.setQueryData(["medicine-detail", "med-1"], { seeded: true });

    await expect(invalidateMedicineViews(qc)).resolves.not.toThrow();
    expect(staleKeys()).toContain(JSON.stringify(["medicine-detail", "med-1"]));
  });
});

/**
 * The desk counters describe the shop, not this tab: another till bills, stock
 * is received, a doctor calls the next token. They poll, and the Refresh
 * button reaches them on demand.
 */
describe("invalidateCounterDesk", () => {
  const DESK_KEYS = [
    ["counter-today-sale", "2026-08-22", "branch-1"],
    ["counter-low-stock", "branch-1"],
    ["counter-rx-today", "branch-1"],
    ["counter-otc-today", "2026-08-22", "branch-1"],
    ["counter-served-today", "2026-08-22", "branch-1"],
    ["counter-clinic-queue", "2026-08-22", "branch-1"],
  ];

  it("refreshes every counter on the desk", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    DESK_KEYS.forEach((k, i) => qc.setQueryData(k, { seeded: i }));
    await invalidateCounterDesk(qc);

    const stale = qc.getQueryCache().getAll().filter((q) => q.state.isInvalidated).length;
    expect(stale).toBe(DESK_KEYS.length);
  });

  it("does not drag the medicine catalogue along on every poll", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["counter-today-sale", "x"], { seeded: true });
    qc.setQueryData(["medicines", "list", { search: "dolo" }], { seeded: true });
    await invalidateCounterDesk(qc);

    // A minute-by-minute poll that also refetched the catalogue would be a
    // very different and much heavier thing than a counter refresh.
    const stale = qc
      .getQueryCache()
      .getAll()
      .filter((q) => q.state.isInvalidated)
      .map((q) => q.queryKey[0]);
    expect(stale).toEqual(["counter-today-sale"]);
  });
});
