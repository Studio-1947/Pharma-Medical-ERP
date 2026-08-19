import { describe, it, expect } from "vitest";
import { TaxService } from "../tax.service";

/**
 * An OTC counter sale is priced twice: once in the browser, to show the
 * customer what to pay and to tender that amount, and once here, when the
 * invoice is written. `createInTransaction` rejects an over-payment outright
 * and refuses an under-paid walk-in, so the two figures must agree to the
 * paisa or the sale fails at the counter.
 *
 * This runs the counter's case table through the real TaxService, the way
 * BillingService assembles a line: per-batch allocation, price =
 * mrpAtEntry / stripSize, discount before GST, per-line rounding, then
 * aggregate. The identical table is asserted against the browser-side helper
 * in frontend/lib/__tests__/otc-quote.cases.ts — keep the two in step.
 */

interface Case {
  name: string;
  /** Allocation the FEFO selector would return, in expiry order. */
  allocations: { mrpAtEntry: string; allocate: number }[];
  discountPct: number;
  taxPct: number;
  stripSize: number;
  expected: { subtotal: number; tax: number; total: number };
}

const CASES: Case[] = [
  {
    name: "one full strip, 12% GST",
    allocations: [{ mrpAtEntry: "85.50", allocate: 10 }],
    discountPct: 0,
    taxPct: 12,
    stripSize: 10,
    expected: { subtotal: 85.5, tax: 10.26, total: 95.76 },
  },
  {
    name: "four loose tablets, 7.5% discount, 5% GST",
    allocations: [{ mrpAtEntry: "63.70", allocate: 4 }],
    discountPct: 7.5,
    taxPct: 5,
    stripSize: 15,
    expected: { subtotal: 15.71, tax: 0.79, total: 16.5 },
  },
  {
    name: "split across two batches, 18% GST",
    allocations: [
      { mrpAtEntry: "45.00", allocate: 3 },
      { mrpAtEntry: "47.25", allocate: 2 },
    ],
    discountPct: 0,
    taxPct: 18,
    stripSize: 1,
    expected: { subtotal: 229.5, tax: 41.31, total: 270.81 },
  },
  {
    name: "odd paise, 12.5% discount, 12% GST",
    allocations: [{ mrpAtEntry: "119.99", allocate: 7 }],
    discountPct: 12.5,
    taxPct: 12,
    stripSize: 20,
    expected: { subtotal: 36.75, tax: 4.41, total: 41.16 },
  },
  {
    name: "GST-free item, no discount",
    allocations: [{ mrpAtEntry: "250.00", allocate: 2 }],
    discountPct: 0,
    taxPct: 0,
    stripSize: 1,
    expected: { subtotal: 500, tax: 0, total: 500 },
  },
];

describe("OTC counter sale — server price matches the counter's quote", () => {
  const tax = new TaxService();

  for (const c of CASES) {
    it(c.name, () => {
      // Mirrors BillingService.createInTransaction: one line per allocation,
      // priced from the batch's own mrpAtEntry divided by the strip size.
      const lines = c.allocations.map((a) => {
        const unitMrp = parseFloat(a.mrpAtEntry) / (c.stripSize || 1);
        const { lineTotal, taxAmount, breakdown } = tax.calculateLineTax(
          unitMrp,
          a.allocate,
          c.discountPct,
          c.taxPct,
          false,
        );
        return { lineTotal, taxAmount, taxableAmount: breakdown.taxableAmount };
      });

      const totals = tax.aggregateInvoiceTotals(lines);

      expect(totals.subtotal).toBe(c.expected.subtotal);
      expect(totals.taxAmount).toBe(c.expected.tax);
      // What the invoice charges — subtotal (already discounted) + tax, the
      // same identity finalTotal holds when there is no invoice-level
      // discount, no loyalty redemption and no consultation fee.
      expect(totals.totalAmount).toBe(c.expected.total);
    });
  }

  it("charges GST on the discounted value, so the counter can quote it before payment", () => {
    const { lineTotal, breakdown } = tax.calculateLineTax(100, 1, 10, 12, false);
    expect(breakdown.taxableAmount).toBe(90);
    expect(breakdown.totalTax).toBe(10.8);
    expect(lineTotal).toBe(100.8);
  });
});
