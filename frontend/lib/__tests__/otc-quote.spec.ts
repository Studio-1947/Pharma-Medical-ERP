import { describe, it, expect } from "vitest";
import { quoteOtcSale } from "../otc-quote";
import { OTC_QUOTE_CASES } from "./otc-quote.cases";

/**
 * The counter tenders exactly what this function returns, and the invoice
 * route rejects both an over-payment and an under-paid walk-in — so a paisa of
 * drift from the server's arithmetic fails the sale outright.
 *
 * The expected figures in OTC_QUOTE_CASES are asserted against the real
 * TaxService in backend/src/modules/billing/__tests__/otc-quote-parity.spec.ts.
 * The two suites share the case table so neither side can drift silently.
 */
describe("quoteOtcSale", () => {
  for (const c of OTC_QUOTE_CASES) {
    it(`matches the server's total: ${c.name}`, () => {
      const q = quoteOtcSale({
        batches: c.batches,
        units: c.units,
        discountPct: c.discountPct,
        taxPct: c.taxPct,
        stripSize: c.stripSize,
      });
      expect(q.subtotal).toBe(c.expected.subtotal);
      expect(q.tax).toBe(c.expected.tax);
      expect(q.total).toBe(c.expected.total);
      expect(q.short).toBe(0);
    });
  }

  it("allocates in FEFO order and splits across batches", () => {
    const q = quoteOtcSale({
      batches: [
        { batchNo: "NEAR", quantity: 4, mrpAtEntry: "100.00", expiryDate: "2026-10-31" },
        { batchNo: "FRESH", quantity: 50, mrpAtEntry: "100.00", expiryDate: "2027-10-31" },
      ],
      units: 10,
      discountPct: 0,
      taxPct: 0,
      stripSize: 1,
    });

    expect(q.used).toEqual([
      { batchNo: "NEAR", expiryDate: "2026-10-31", units: 4 },
      { batchNo: "FRESH", expiryDate: "2027-10-31", units: 6 },
    ]);
    expect(q.total).toBe(1000);
  });

  it("skips batches whose stock is entirely reserved for open carts", () => {
    const q = quoteOtcSale({
      batches: [
        { batchNo: "HELD", quantity: 5, reservedQty: 5, mrpAtEntry: "100.00" },
        { batchNo: "FREE", quantity: 5, reservedQty: 1, mrpAtEntry: "100.00" },
      ],
      units: 4,
      discountPct: 0,
      taxPct: 0,
      stripSize: 1,
    });

    expect(q.used.map((u) => u.batchNo)).toEqual(["FREE"]);
    expect(q.short).toBe(0);
  });

  it("reports the shortfall rather than quoting a price the branch cannot fill", () => {
    const q = quoteOtcSale({
      batches: [{ batchNo: "ONLY", quantity: 3, mrpAtEntry: "100.00" }],
      units: 10,
      discountPct: 0,
      taxPct: 0,
      stripSize: 1,
    });

    expect(q.short).toBe(7);
  });

  it("takes the discount off before GST, not after", () => {
    const full = quoteOtcSale({
      batches: [{ batchNo: "B1", quantity: 100, mrpAtEntry: "100.00" }],
      units: 1,
      discountPct: 0,
      taxPct: 12,
      stripSize: 1,
    });
    const discounted = quoteOtcSale({
      batches: [{ batchNo: "B1", quantity: 100, mrpAtEntry: "100.00" }],
      units: 1,
      discountPct: 10,
      taxPct: 12,
      stripSize: 1,
    });

    expect(full.total).toBe(112);
    // 90 taxable + 10.80 GST. Charging GST on the undiscounted 100 would give
    // 102 and overstate the liability on every discounted sale.
    expect(discounted.subtotal).toBe(90);
    expect(discounted.tax).toBe(10.8);
    expect(discounted.total).toBe(100.8);
  });

  it("prices a loose unit at the pack price divided by the strip size", () => {
    const q = quoteOtcSale({
      batches: [{ batchNo: "B1", quantity: 100, mrpAtEntry: "200.00" }],
      units: 1,
      discountPct: 0,
      taxPct: 0,
      stripSize: 20,
    });

    expect(q.total).toBe(10);
  });
});
