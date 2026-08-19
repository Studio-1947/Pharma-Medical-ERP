import type { OtcQuoteBatch } from "../otc-quote";

/**
 * Shared expectations for an OTC counter sale's price.
 *
 * Two suites assert the same numbers, from opposite ends:
 *   - frontend/lib/__tests__/otc-quote.spec.ts     — what the counter tenders
 *   - backend/src/modules/billing/__tests__/otc-quote-parity.spec.ts
 *                                                  — what TaxService charges
 *
 * They are asserted separately rather than shared at runtime (the packages do
 * not import each other's test code), so a change to either side's arithmetic
 * fails its own suite instead of silently drifting apart. The invoice route
 * rejects both an over-payment and an under-paid walk-in, so a one-paisa gap
 * between the two is a failed sale at the counter, not a rounding curiosity.
 *
 * Keep the two tables identical when adding a case.
 */
export interface OtcQuoteCase {
  name: string;
  batches: OtcQuoteBatch[];
  /** Quantity in the unit the invoice API speaks (packs x stripSize, or loose). */
  units: number;
  discountPct: number;
  taxPct: number;
  stripSize: number;
  expected: { subtotal: number; tax: number; total: number };
}

export const OTC_QUOTE_CASES: OtcQuoteCase[] = [
  {
    name: "one full strip, 12% GST",
    batches: [{ batchNo: "B1", quantity: 100, mrpAtEntry: "85.50" }],
    units: 10,
    discountPct: 0,
    taxPct: 12,
    stripSize: 10,
    expected: { subtotal: 85.5, tax: 10.26, total: 95.76 },
  },
  {
    name: "four loose tablets, 7.5% discount, 5% GST",
    batches: [{ batchNo: "B1", quantity: 150, mrpAtEntry: "63.70" }],
    units: 4,
    discountPct: 7.5,
    taxPct: 5,
    stripSize: 15,
    expected: { subtotal: 15.71, tax: 0.79, total: 16.5 },
  },
  {
    name: "split across two batches, 18% GST",
    batches: [
      { batchNo: "NEAR", quantity: 3, mrpAtEntry: "45.00", expiryDate: "2026-10-31" },
      { batchNo: "FRESH", quantity: 100, mrpAtEntry: "47.25", expiryDate: "2027-10-31" },
    ],
    units: 5,
    discountPct: 0,
    taxPct: 18,
    stripSize: 1,
    expected: { subtotal: 229.5, tax: 41.31, total: 270.81 },
  },
  {
    name: "odd paise, 12.5% discount, 12% GST",
    batches: [{ batchNo: "B1", quantity: 60, mrpAtEntry: "119.99" }],
    units: 7,
    discountPct: 12.5,
    taxPct: 12,
    stripSize: 20,
    expected: { subtotal: 36.75, tax: 4.41, total: 41.16 },
  },
  {
    name: "GST-free item, no discount",
    batches: [{ batchNo: "B1", quantity: 20, mrpAtEntry: "250.00" }],
    units: 2,
    discountPct: 0,
    taxPct: 0,
    stripSize: 1,
    expected: { subtotal: 500, tax: 0, total: 500 },
  },
];
