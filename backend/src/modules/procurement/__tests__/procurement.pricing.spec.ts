import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { calculateLine } from "../procurement.pricing";

describe("calculateLine", () => {
  it("applies discount to unit cost before tax", () => {
    // 100 - 10% = 90/unit * 2 = 180 base, +12% tax = 201.60
    const { lineCost, lineTax, lineTotal } = calculateLine({
      unitCost: "100",
      taxPct: "12",
      discountPct: "10",
      qty: 2,
    });

    expect(lineCost.toFixed(2)).toBe("180.00");
    expect(lineTax.toFixed(2)).toBe("21.60");
    expect(lineTotal.toFixed(2)).toBe("201.60");
  });

  it("treats a missing discount as zero", () => {
    const { lineTotal } = calculateLine({ unitCost: "50", taxPct: "18", qty: 3 });
    expect(lineTotal.toFixed(2)).toBe("177.00");
  });

  it("returns zero for a zero quantity (free-qty-only GRN line)", () => {
    const { lineTotal } = calculateLine({
      unitCost: "99.99",
      taxPct: "12",
      discountPct: "5",
      qty: 0,
    });
    expect(lineTotal.toFixed(2)).toBe("0.00");
  });

  // The reason this module uses Decimal: these are the classic values where
  // binary floating point drifts. 0.1 + 0.2 !== 0.3 in float.
  it("does not accumulate binary floating point drift", () => {
    const line = calculateLine({ unitCost: "0.1", taxPct: "0", qty: 3 });
    expect(line.lineTotal.equals(new Decimal("0.3"))).toBe(true);
    // Guard against a regression back to float math.
    expect(line.lineTotal.toNumber()).not.toBe(0.1 * 3);
  });

  it("stays exact when many lines are summed, unlike float", () => {
    // 10 lines of 0.07 each. In float this sums to 0.7000000000000001.
    let total = new Decimal(0);
    for (let i = 0; i < 10; i++) {
      total = total.plus(calculateLine({ unitCost: "0.07", taxPct: "0", qty: 1 }).lineTotal);
    }
    expect(total.toFixed(2)).toBe("0.70");
    expect(total.equals(new Decimal("0.7"))).toBe(true);
  });

  it("settles a bill to exactly zero, so 'paid' needs no epsilon", () => {
    // A bill of three 33.33 lines totals 99.99; paying 99.99 must leave 0 exactly.
    const billed = [1, 2, 3].reduce(
      (sum) => sum.plus(calculateLine({ unitCost: "33.33", taxPct: "0", qty: 1 }).lineTotal),
      new Decimal(0),
    );
    expect(billed.toFixed(2)).toBe("99.99");

    const balance = billed.minus(new Decimal("99.99"));
    expect(balance.isZero()).toBe(true);
    expect(balance.lessThanOrEqualTo(0)).toBe(true);
  });
});
