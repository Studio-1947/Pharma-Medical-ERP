import { describe, it, expect } from "vitest";
import { queryMedicineSchema } from "@pharmerp/types";

/**
 * Guards the parsing of the medicine list's boolean query parameters.
 *
 * The original schema used z.coerce.boolean(), which runs JavaScript's
 * Boolean(). Every non-empty string is truthy, so "false" parsed as true and
 * `?isActive=false` returned the ACTIVE list. Combined with the repository
 * defaulting to active-only when the parameter is absent, that made every
 * inactive medicine unreachable through the API — which is how ~26k rows that a
 * bulk import parked inactive for want of an MRP became invisible on every
 * screen in the app while still occupying their SKUs.
 */
describe("queryMedicineSchema boolean flags", () => {
  const parse = (q: Record<string, unknown>) => queryMedicineSchema.parse(q);

  it("parses isActive=false as false, not true", () => {
    // The whole bug in one assertion.
    expect(parse({ isActive: "false" }).isActive).toBe(false);
  });

  it("parses isActive=true as true", () => {
    expect(parse({ isActive: "true" }).isActive).toBe(true);
  });

  it("keeps isActive=all as a distinct third state", () => {
    // Must stay the literal "all" — the repository drops the WHERE clause on
    // exactly this value, and coercing it to a boolean would silently filter.
    expect(parse({ isActive: "all" }).isActive).toBe("all");
  });

  it("leaves isActive undefined when absent, so callers keep active-only", () => {
    // The POS, counter and transfer searches all omit the parameter and rely on
    // the repository's active-only default. Absence must not become "all".
    expect(parse({}).isActive).toBeUndefined();
  });

  it("accepts the alternative truthy spellings a client may send", () => {
    expect(parse({ isActive: "1" }).isActive).toBe(true);
    expect(parse({ isActive: "yes" }).isActive).toBe(true);
    expect(parse({ isActive: "TRUE" }).isActive).toBe(true);
  });

  it("treats any other string as false rather than truthy", () => {
    expect(parse({ isActive: "0" }).isActive).toBe(false);
    expect(parse({ isActive: "no" }).isActive).toBe(false);
  });

  it("applies the same parsing to requiresPrescription", () => {
    // Same latent defect on the adjacent line: an OTC-only filter was
    // impossible to express.
    expect(parse({ requiresPrescription: "false" }).requiresPrescription).toBe(false);
    expect(parse({ requiresPrescription: "true" }).requiresPrescription).toBe(true);
    expect(parse({}).requiresPrescription).toBeUndefined();
  });

  it("still accepts real booleans, for callers that build the DTO directly", () => {
    expect(parse({ isActive: false }).isActive).toBe(false);
    expect(parse({ isActive: true }).isActive).toBe(true);
  });
});

/**
 * The repository's branch on the parsed value. Kept in step with
 * InventoryRepository.findMedicinesPaginated: `if (params.isActive !== "all")`
 * push `eq(isActive, params.isActive ?? true)`.
 */
describe("isActive to WHERE-clause mapping", () => {
  const filterFor = (isActive: boolean | "all" | undefined) =>
    isActive === "all" ? "no filter" : `is_active = ${isActive ?? true}`;

  it("filters to active when the parameter is absent", () => {
    expect(filterFor(queryMedicineSchema.parse({}).isActive)).toBe("is_active = true");
  });

  it("filters to inactive on isActive=false", () => {
    expect(filterFor(queryMedicineSchema.parse({ isActive: "false" }).isActive)).toBe(
      "is_active = false",
    );
  });

  it("drops the filter entirely on isActive=all", () => {
    expect(filterFor(queryMedicineSchema.parse({ isActive: "all" }).isActive)).toBe("no filter");
  });
});
