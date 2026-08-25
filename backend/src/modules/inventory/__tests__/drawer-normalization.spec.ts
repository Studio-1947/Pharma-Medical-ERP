import { describe, it, expect } from "vitest";
import { normalizeDrawerMapping } from "../inventory.service";

/**
 * Left free, the same drawer arrives as "11", "d11", "D 11" and "Drawer 11",
 * and none of them match each other. The drawer filter is an exact match —
 * that is what makes a shelf count reconcile — so four spellings of one drawer
 * report four drawers where the shop has one.
 *
 * What is deliberately NOT normalised matters as much: "Rack A-1" and
 * "Lockbox H1-1" name their own kind of place, and the difference between a
 * rack and the lockbox that Schedule H1 stock lives in is worth keeping.
 */
describe("drawer label normalisation", () => {
  it("reads a bare number as a drawer", () => {
    expect(normalizeDrawerMapping("11")).toBe("Drawer 11");
    expect(normalizeDrawerMapping("  7 ")).toBe("Drawer 7");
  });

  it("treats every spelling of one drawer as the same drawer", () => {
    // The whole point: these four used to be four different drawers.
    for (const typed of ["11", "d11", "D 11", "D-11"]) {
      expect(normalizeDrawerMapping(typed), typed).toBe("Drawer 11");
    }
    for (const typed of ["drawer 11", "Drawer 11", "DRAWER 11", "drawer  11"]) {
      expect(normalizeDrawerMapping(typed), typed).toBe("Drawer 11");
    }
  });

  it("keeps a label that names its own kind of place", () => {
    expect(normalizeDrawerMapping("Rack A-1")).toBe("Rack A-1");
    expect(normalizeDrawerMapping("Lockbox H1-1")).toBe("Lockbox H1-1");
    expect(normalizeDrawerMapping("Shelf 3")).toBe("Shelf 3");
  });

  it("tidies only the capital on those, never the label itself", () => {
    // "rack a-1" and "Rack A-1" are one place; "A-1" is the operator's and is
    // not second-guessed into some other case.
    expect(normalizeDrawerMapping("rack A-1")).toBe("Rack A-1");
    expect(normalizeDrawerMapping("LOCKBOX H1-1")).toBe("Lockbox H1-1");
  });

  it("leaves an ordinary label alone", () => {
    // "A3" is already a label. Nothing here knows better than the operator.
    expect(normalizeDrawerMapping("A3")).toBe("A3");
    expect(normalizeDrawerMapping("B7")).toBe("B7");
    expect(normalizeDrawerMapping("Cold room")).toBe("Cold room");
  });

  it("does not mistake a word beginning with a storage word for one", () => {
    // This is what a `\\b` that had decayed into a backspace character would
    // get wrong, and it would fail silently.
    expect(normalizeDrawerMapping("Boxwood shelf")).toBe("Boxwood shelf");
    expect(normalizeDrawerMapping("Rackham")).toBe("Rackham");
  });

  it("lets a drawer be cleared", () => {
    expect(normalizeDrawerMapping("")).toBe("");
    expect(normalizeDrawerMapping("   ")).toBe("");
  });

  it("leaves an absent value absent, rather than blanking it", () => {
    // A PATCH that does not mention the drawer must not erase it.
    expect(normalizeDrawerMapping(undefined)).toBeUndefined();
    expect(normalizeDrawerMapping(null)).toBeUndefined();
  });
});
