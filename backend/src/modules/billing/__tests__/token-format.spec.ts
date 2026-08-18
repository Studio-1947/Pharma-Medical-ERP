import { describe, expect, it } from "vitest";
import { formatTokenNo, PHARMACY_PRINT_DETAILS } from "@pharmerp/types";

/**
 * formatTokenNo decides whether the token row renders at all, on every printed
 * surface: POS receipt, both PDF generators, the prescription and the public
 * record page. A wrong falsy check here prints "Token No. 0" or an empty box on
 * a patient's bill, so the edge cases are pinned down rather than assumed.
 *
 * Tested from the backend suite because it is the only workspace with a test
 * runner; the helper itself is shared and has no backend dependency.
 */
describe("formatTokenNo", () => {
  it("pads to three digits so tokens sort and read consistently", () => {
    expect(formatTokenNo(1)).toBe("001");
    expect(formatTokenNo(42)).toBe("042");
    expect(formatTokenNo(999)).toBe("999");
  });

  it("does not truncate tokens that outgrow three digits", () => {
    expect(formatTokenNo(1000)).toBe("1000");
    expect(formatTokenNo(12345)).toBe("12345");
  });

  it("returns null when there is no token, so the row is omitted", () => {
    // The walk-in case. Every caller treats null as "render nothing".
    expect(formatTokenNo(null)).toBeNull();
    expect(formatTokenNo(undefined)).toBeNull();
    expect(formatTokenNo("")).toBeNull();
  });

  it("treats zero and negatives as absent rather than printing them", () => {
    // Queue numbering starts at 1. A 0 reaching a bill would mean a bug
    // upstream, and printing "Token No. 000" would look authoritative.
    expect(formatTokenNo(0)).toBeNull();
    expect(formatTokenNo(-1)).toBeNull();
    expect(formatTokenNo("0")).toBeNull();
  });

  it("accepts numeric strings, since JSON payloads may carry either", () => {
    expect(formatTokenNo("42")).toBe("042");
    expect(formatTokenNo("7")).toBe("007");
  });

  it("rejects values that are not numbers at all", () => {
    expect(formatTokenNo("abc")).toBeNull();
    expect(formatTokenNo(NaN)).toBeNull();
    expect(formatTokenNo(Infinity)).toBeNull();
  });

  it("truncates a fractional token rather than printing a decimal", () => {
    expect(formatTokenNo(42.7)).toBe("042");
  });
});

describe("PHARMACY_PRINT_DETAILS", () => {
  it("carries the honorific on the legal name used by bills", () => {
    // The bill must read "Shree ...", while the app UI and logo artwork use the
    // plain trading name. Regressing this is a compliance/branding issue that
    // no other test would catch.
    expect(PHARMACY_PRINT_DETAILS.legalName).toBe("Shree Radha Madhav Medical Hall");
    expect(PHARMACY_PRINT_DETAILS.tradingName).toBe("Radha Madhav Medical Hall");
    expect(PHARMACY_PRINT_DETAILS.legalName.startsWith("Shree ")).toBe(true);
  });

  it("carries the address and phone printed on every document", () => {
    expect(PHARMACY_PRINT_DETAILS.addressLine).toBe(
      "Krishna Nagar, Near Mirik BPHC, Mirik-734214",
    );
    expect(PHARMACY_PRINT_DETAILS.phone).toBe("73844 57427, 97759 31980");
  });
});
