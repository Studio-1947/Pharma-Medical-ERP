import { describe, expect, it } from "vitest";
import { createGrnSchema } from "@pharmerp/types";

const item = {
  poItemId: "55555555-5555-5555-5555-555555555555",
  receivedQty: 200,
  rejectedQty: 0,
  freeQty: 40,
  batchNo: "SCHEME-200",
  expiryDate: "2027-12-31",
};

describe("GRN free quantity validation", () => {
  it("accepts 200 received with 40 free", () => {
    expect(createGrnSchema.parse({
      poId: "33333333-3333-3333-3333-333333333333",
      qcPassed: true,
      items: [item],
    }).items[0]).toMatchObject({ receivedQty: 200, freeQty: 40 });
  });

  it("rejects free stock greater than total physical stock", () => {
    expect(() => createGrnSchema.parse({
      poId: "33333333-3333-3333-3333-333333333333",
      qcPassed: true,
      items: [{ ...item, freeQty: 201 }],
    })).toThrow(/Free quantity cannot exceed/);
  });
});
