import type { QueryClient } from "@tanstack/react-query";

/**
 * Query key roots that show a medicine's status, price, batches or stock.
 *
 * These grew organically — "medicine-search-counter", "counter-medicine-search",
 * "otc-add-medicine-search", "medicines", "low-stock", "expiring-batches" and a
 * dozen more — each screen naming its own. Every mutation that touched a
 * medicine therefore had to remember the full list, and none of them did: the
 * three "Set MRP & Activate" modals invalidated nothing at all, so a medicine
 * you had just activated went on being listed as Inactive at ₹0.00 until the
 * operator reloaded the page by hand.
 *
 * Matching on the key root rather than enumerating keys means a screen added
 * later is covered without anyone having to remember this file exists.
 */
const MEDICINE_VIEW_ROOT = /medicine|batch|stock|inventory|expir/i;

/**
 * Marks every cached view of a medicine stale after one has changed.
 *
 * Only mounted queries refetch immediately; the rest are simply flagged, so
 * this is cheap to call from any mutation and there is no reason to be
 * selective about it. Await it when the next thing you do depends on fresh
 * data; otherwise fire and forget.
 */
export function invalidateMedicineViews(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    predicate: (query) => {
      const root = query.queryKey[0];
      return typeof root === "string" && MEDICINE_VIEW_ROOT.test(root);
    },
  });
}
