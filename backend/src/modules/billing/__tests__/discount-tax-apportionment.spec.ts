import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { TaxService } from "../tax.service";

/**
 * An invoice-level discount used to be subtracted from the total *after* the
 * tax had been computed, so GST was charged on money the patient never paid.
 * The printed bill still balanced — subtotal − discount + tax = total — which
 * is why it went unnoticed; only the GST return was wrong.
 *
 * The apportionment has to land to the paisa: if the line CGST/SGST figures do
 * not sum to the invoice tax, a GSTR-1 reconciliation fails on the difference.
 */

const service = new TaxService();

const sum = (xs: number[]) =>
  xs.reduce((a, b) => new Decimal(a).plus(b).toNumber(), 0);

describe("apportionDiscountAcrossLines", () => {
  it("taxes the discounted value, not the list value", () => {
    // One line, 1000.00 taxable at 12%. A 100.00 discount leaves 900.00.
    const [line] = service.apportionDiscountAcrossLines(
      [{ taxableAmount: 1000, taxPct: 12 }],
      100,
    );

    expect(line!.taxableAmount).toBe(900);
    expect(line!.taxAmount).toBe(108); // 12% of 900, not of 1000
    expect(line!.lineTotal).toBe(1008);
  });

  it("splits the discount in proportion to each line's taxable value", () => {
    const lines = service.apportionDiscountAcrossLines(
      [
        { taxableAmount: 750, taxPct: 12 },
        { taxableAmount: 250, taxPct: 5 },
      ],
      100,
    );

    expect(lines[0]!.discountShare).toBe(75);
    expect(lines[1]!.discountShare).toBe(25);
    // Each line keeps its own rate.
    expect(lines[0]!.taxAmount).toBe(81); // 12% of 675
    expect(lines[1]!.taxAmount).toBe(11.25); // 5% of 225
  });

  it("distributes to the paisa when the split does not divide evenly", () => {
    // 10.00 across three equal lines is 3.333… each; someone must take the
    // extra paisa or the shares will not sum to the discount.
    const lines = service.apportionDiscountAcrossLines(
      [
        { taxableAmount: 100, taxPct: 12 },
        { taxableAmount: 100, taxPct: 12 },
        { taxableAmount: 100, taxPct: 12 },
      ],
      10,
    );

    expect(sum(lines.map((l) => l.discountShare))).toBe(10);
  });

  it("keeps line GST summing exactly to what the invoice will report", () => {
    const input = [
      { taxableAmount: 333.33, taxPct: 12 },
      { taxableAmount: 66.67, taxPct: 5 },
      { taxableAmount: 100.01, taxPct: 18 },
    ];
    const lines = service.apportionDiscountAcrossLines(input, 37.77);

    expect(sum(lines.map((l) => l.discountShare))).toBe(37.77);
    for (const l of lines) {
      expect(new Decimal(l.breakdown.cgst).plus(l.breakdown.sgst).toNumber()).toBeCloseTo(
        l.taxAmount,
        2,
      );
    }
  });

  it("puts the whole tax in IGST for an inter-state supply", () => {
    const [line] = service.apportionDiscountAcrossLines(
      [{ taxableAmount: 1000, taxPct: 12 }],
      100,
      true,
    );

    expect(line!.breakdown.igst).toBe(108);
    expect(line!.breakdown.cgst).toBe(0);
    expect(line!.breakdown.sgst).toBe(0);
  });

  it("changes nothing when there is no discount", () => {
    const [line] = service.apportionDiscountAcrossLines(
      [{ taxableAmount: 500, taxPct: 18 }],
      0,
    );

    expect(line!.discountShare).toBe(0);
    expect(line!.taxableAmount).toBe(500);
    expect(line!.taxAmount).toBe(90);
  });

  it("never produces negative tax when the discount exceeds the taxable base", () => {
    // The excess belongs to GST-exempt value, such as a consultation fee.
    const [line] = service.apportionDiscountAcrossLines(
      [{ taxableAmount: 200, taxPct: 12 }],
      500,
    );

    expect(line!.taxableAmount).toBe(0);
    expect(line!.taxAmount).toBe(0);
    expect(line!.discountShare).toBe(200);
  });

  it("survives a zero-value line without dividing by zero", () => {
    const lines = service.apportionDiscountAcrossLines(
      [
        { taxableAmount: 0, taxPct: 12 },
        { taxableAmount: 100, taxPct: 12 },
      ],
      10,
    );

    expect(lines[0]!.discountShare).toBe(0);
    expect(lines[1]!.discountShare).toBe(10);
  });

  it("handles an empty cart", () => {
    expect(service.apportionDiscountAcrossLines([], 50)).toEqual([]);
  });

  it("ignores a negative discount rather than inflating the tax", () => {
    const [line] = service.apportionDiscountAcrossLines(
      [{ taxableAmount: 100, taxPct: 12 }],
      -50,
    );

    expect(line!.taxableAmount).toBe(100);
    expect(line!.taxAmount).toBe(12);
  });
});

describe("the invoice identity still holds", () => {
  it("subtotal − discount + tax equals the charged total", () => {
    const input = [
      { taxableAmount: 800, taxPct: 12 },
      { taxableAmount: 200, taxPct: 5 },
    ];
    const discount = 150;

    const preDiscountSubtotal = sum(input.map((l) => l.taxableAmount));
    const lines = service.apportionDiscountAcrossLines(input, discount);
    const tax = sum(lines.map((l) => l.taxAmount));
    const charged = sum(lines.map((l) => l.lineTotal));

    expect(new Decimal(preDiscountSubtotal).minus(discount).plus(tax).toNumber()).toBe(
      charged,
    );
  });
});
