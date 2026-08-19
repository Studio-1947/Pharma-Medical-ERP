import { describe, it, expect } from "vitest";
import { isControlledSchedule } from "../billing.service";

/**
 * The Rx gate must recognise a Schedule H drug however the catalogue spells it.
 *
 * The seed writes "SCHEDULE_H"; the imported catalogue on the live database
 * writes "H" (3,911 rows, plus 222 H1 and 5 X). While the check matched only
 * the seed's spelling it was dead code against real data, and the gate held
 * solely because those rows also carry requires_prescription = true — one
 * import that missed that flag and a Schedule H sale would have gone through
 * the counter with no prescription.
 */
describe("isControlledSchedule", () => {
  for (const value of [
    "SCHEDULE_H",
    "SCHEDULE_H1",
    "SCHEDULE_X",
    "H",
    "H1",
    "X",
    "h1",
    " schedule h ",
    "Schedule-X",
  ]) {
    it(`treats ${JSON.stringify(value)} as prescription-only`, () => {
      expect(isControlledSchedule(value)).toBe(true);
    });
  }

  // Not a controlled SCHEDULE — which is not the same as "sellable freely".
  // "Rx" carries requires_prescription = true, and the caller ORs the two.
  for (const value of ["OTC", "Rx", "", null, undefined, "SCHEDULE_G", "HX"]) {
    it(`does not classify ${JSON.stringify(value)} as a controlled schedule`, () => {
      expect(isControlledSchedule(value)).toBe(false);
    });
  }
});
