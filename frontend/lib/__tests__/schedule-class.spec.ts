import { describe, it, expect } from "vitest";
import {
  normalizeScheduleClass,
  isControlledScheduleClass,
  scheduleLabel,
  isControlledRow,
} from "../schedule-class";

/**
 * Every screen used to carry its own copy of ["SCHEDULE_H", ...]. The live
 * catalogue stores "H", so those copies matched nothing: the POS Rx blocker,
 * the OTC modal's gate and the medicine form's auto-tick all fell back to the
 * requiresPrescription flag — and the form never set that flag, because its
 * dropdown emits "H" too. Both spellings must classify identically.
 */
describe("schedule classification", () => {
  it.each([
    ["SCHEDULE_H", "H"],
    ["SCHEDULE_H1", "H1"],
    ["SCHEDULE_X", "X"],
    ["H", "H"],
    ["h1", "H1"],
    [" schedule-x ", "X"],
    ["OTC", "OTC"],
    ["G", "G"],
    ["", null],
    [null, null],
    ["NA", null],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeScheduleClass(input)).toBe(expected);
  });

  it.each(["SCHEDULE_H", "SCHEDULE_H1", "SCHEDULE_X", "H", "H1", "X", "h", " schedule h "])(
    "treats %s as prescription-only",
    (value) => {
      expect(isControlledScheduleClass(value)).toBe(true);
    },
  );

  it.each(["OTC", "G", "", null, undefined, "HX", "SCHEDULE_G"])(
    "does not treat %s as a controlled schedule",
    (value) => {
      expect(isControlledScheduleClass(value)).toBe(false);
    },
  );

  it("labels a controlled class for display and stays quiet otherwise", () => {
    expect(scheduleLabel("H1")).toBe("Schedule H1");
    expect(scheduleLabel("SCHEDULE_H")).toBe("Schedule H");
    expect(scheduleLabel("OTC")).toBeNull();
    expect(scheduleLabel(null)).toBeNull();
  });

  describe("isControlledRow", () => {
    it("blocks on the schedule alone, without the prescription flag", () => {
      expect(isControlledRow({ scheduleClass: "H1", requiresPrescription: false })).toBe(true);
    });

    it("blocks on the flag alone, whatever the schedule says", () => {
      expect(isControlledRow({ scheduleClass: "OTC", requiresPrescription: true })).toBe(true);
    });

    it("lets a genuine over-the-counter row through", () => {
      expect(isControlledRow({ scheduleClass: "OTC", requiresPrescription: false })).toBe(false);
      expect(isControlledRow({})).toBe(false);
    });
  });
});
