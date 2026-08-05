import { describe, it, expect, beforeEach, vi } from "vitest";
import { ProcurementRepository } from "../procurement.repository";
import * as schema from "../../../database/schema";

/**
 * Goods inward is the one path where stock enters the system, and the branch it
 * lands in comes from a single value: the purchase order's `branchId`.
 *
 * Get it wrong and there is no error — the stock simply appears in another
 * branch's shelves, and the branch that paid for it sees nothing. Nothing
 * downstream can detect that, which is why it is pinned here.
 */

const BRANCH_ORDERING = "11111111-1111-1111-1111-111111111111";
const BRANCH_OTHER = "22222222-2222-2222-2222-222222222222";
const PO_ID = "33333333-3333-3333-3333-333333333333";
const MEDICINE_ID = "44444444-4444-4444-4444-444444444444";
const PO_ITEM_ID = "55555555-5555-5555-5555-555555555555";
const SUPPLIER_ID = "66666666-6666-6666-6666-666666666666";
const LOCATION_ID = "77777777-7777-7777-7777-777777777777";
const GRN_ID = "88888888-8888-8888-8888-888888888888";
const BATCH_ID = "99999999-9999-9999-9999-999999999999";

/** Records every insert so the test can assert on what was written. */
function buildDbMock(opts: { locationExists: boolean }) {
  const inserts: { table: unknown; values: any }[] = [];

  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: () => Promise.resolve(opts.locationExists ? [{ id: LOCATION_ID }] : []),
  };

  const db: any = {
    query: {
      purchaseOrders: {
        findFirst: vi.fn().mockResolvedValue({
          id: PO_ID,
          // The ordering branch — the value the batch must inherit.
          branchId: BRANCH_ORDERING,
          supplierId: SUPPLIER_ID,
          items: [
            {
              id: PO_ITEM_ID,
              medicineId: MEDICINE_ID,
              unitCost: "10.00",
              taxPct: "12",
              discountPct: "0",
              isConsignment: false,
            },
          ],
        }),
      },
    },
    select: () => selectChain,
    insert: (table: unknown) => ({
      values: (values: any) => {
        inserts.push({ table, values });
        const returning = () => {
          if (table === schema.goodsReceivedNotes) return Promise.resolve([{ id: GRN_ID }]);
          if (table === schema.inventoryBatches) return Promise.resolve([{ id: BATCH_ID }]);
          if (table === schema.storageLocations) return Promise.resolve([{ id: LOCATION_ID }]);
          return Promise.resolve([{ id: "generic" }]);
        };
        return { returning, then: (r: any) => returning().then(r) };
      },
    }),
    update: () => ({
      set: () => ({ where: () => Promise.resolve([]) }),
    }),
  };

  return { db, inserts };
}

function repoWith(db: any) {
  const repo = new ProcurementRepository({ db } as any);
  return repo;
}

const GRN_DTO = {
  poId: PO_ID,
  supplierInvoiceNo: "INV-1",
  qcPassed: true,
  qcNotes: undefined,
  items: [
    {
      poItemId: PO_ITEM_ID,
      receivedQty: 100,
      rejectedQty: 0,
      freeQty: 0,
      batchNo: "AB1234",
      expiryDate: "2027-01-01",
    },
  ],
} as any;

describe("GRN branch stamping", () => {
  let db: any;
  let inserts: { table: unknown; values: any }[];

  beforeEach(() => {
    ({ db, inserts } = buildDbMock({ locationExists: true }));
  });

  it("stamps the created batch with the ordering PO's branch", async () => {
    await repoWith(db).createGRN(GRN_DTO, "user-1");

    const batchInsert = inserts.find((i) => i.table === schema.inventoryBatches);
    expect(batchInsert, "a batch should be created").toBeDefined();
    expect(batchInsert!.values.branchId).toBe(BRANCH_ORDERING);
    expect(batchInsert!.values.branchId).not.toBe(BRANCH_OTHER);
  });

  it("stamps the stock movement with the same branch as the batch", async () => {
    await repoWith(db).createGRN(GRN_DTO, "user-1");

    const batchInsert = inserts.find((i) => i.table === schema.inventoryBatches);
    const movementInsert = inserts.find((i) => i.table === schema.stockMovements);

    expect(movementInsert, "a stock movement should be logged").toBeDefined();
    // The ledger and the stock it describes must never disagree about branch.
    expect(movementInsert!.values.branchId).toBe(batchInsert!.values.branchId);
  });

  it("records the GRN itself against the ordering branch", async () => {
    await repoWith(db).createGRN(GRN_DTO, "user-1");

    const grnInsert = inserts.find((i) => i.table === schema.goodsReceivedNotes);
    expect(grnInsert!.values.branchId).toBe(BRANCH_ORDERING);
  });

  it("creates a shelf in the ordering branch when it has none, rather than failing", async () => {
    // A newly opened branch has no storage locations. Goods inward used to
    // throw here, which would have made the branch's first delivery impossible.
    const fresh = buildDbMock({ locationExists: false });

    await repoWith(fresh.db).createGRN(GRN_DTO, "user-1");

    const locationInsert = fresh.inserts.find(
      (i) => i.table === schema.storageLocations,
    );
    expect(locationInsert, "a default shelf should be created").toBeDefined();
    expect(locationInsert!.values.branchId).toBe(BRANCH_ORDERING);

    const batchInsert = fresh.inserts.find((i) => i.table === schema.inventoryBatches);
    expect(batchInsert!.values.branchId).toBe(BRANCH_ORDERING);
  });
});
