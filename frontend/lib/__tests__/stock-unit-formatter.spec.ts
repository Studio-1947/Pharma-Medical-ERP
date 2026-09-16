import { describe, expect, it } from "vitest";
import { formatStockUnit, getLooseUnitLabel } from "../stock-unit-formatter";

describe("stock unit formatting", () => {
  it("formats divisible batch stock in tablets rather than strips", () => {
    expect(
      formatStockUnit(8, { unit: "Strip", dosageForm: "Tablet", stripSize: 10 }),
    ).toBe("8 tablets in stock");
  });

  it("uses the actual smallest dose for capsules", () => {
    expect(getLooseUnitLabel(1, { dosageForm: "Capsule" })).toBe("capsule");
    expect(
      formatStockUnit(20, { unit: "Strip", dosageForm: "Capsule", stripSize: 10 }),
    ).toBe("20 capsules in stock");
  });

  it("keeps indivisible stock in its packaging unit", () => {
    expect(
      formatStockUnit(8, { unit: "Bottle", dosageForm: "Syrup", stripSize: 100 }),
    ).toBe("8 Bottles in stock");
  });
});
