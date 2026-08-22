import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

/**
 * A screen that changes a medicine must also tell the cache.
 *
 * Medicine query keys are per-screen, so nothing invalidates on its own. All
 * three "Set MRP & Activate" modals used to invalidate nothing whatsoever: the
 * PATCH succeeded, the server had the medicine active at its new price, and
 * every open list went on showing it as Inactive at ₹0.00 until the operator
 * reloaded the page by hand. That is not a cache subtlety to the person at the
 * counter — it looks like the save did not work.
 *
 * Checked at the source, because the failure is an omission: the code that is
 * missing is invisible to any test of the code that is there, and a fourth
 * activation path added later would repeat it silently.
 */

const ROOT = join(__dirname, "..", "..");
const SCAN_DIRS = ["app", "components", "hooks", "queries"];

/** Marks a call that changes a medicine's own row or its stock. */
const MUTATES_MEDICINE = [
  /apiClient\.patch\(\s*`\/inventory\/medicines\//,
  /apiClient\.post\(\s*"\/inventory\/batches"/,
  /apiClient\.post\(\s*"\/inventory\/medicines"/,
  /apiClient\.delete\(\s*`\/inventory\/medicines\//,
];

/**
 * Files that mutate through a shared hook or hand the refresh to a parent via
 * an onSuccess prop, with the reason. Anything here is asserting that some
 * other file owns the invalidation.
 */
const EXEMPT: Record<string, string> = {
  "components/modules/inventory/batch-list.tsx":
    "hands refresh to its parent through the onSuccess prop",
  "components/modules/inventory/medicine-form.tsx":
    "callers pass onSuccess and invalidate there",
};

function sourceFiles(dir: string): string[] {
  const abs = join(ROOT, dir);
  let entries: string[];
  try {
    entries = readdirSync(abs);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const full = join(abs, entry);
    if (statSync(full).isDirectory()) return sourceFiles(join(dir, entry));
    if (!/\.(ts|tsx)$/.test(entry)) return [];
    if (full.includes("__tests__")) return [];
    return [full];
  });
}

const mutating = SCAN_DIRS.flatMap(sourceFiles)
  .map((file) => ({
    rel: relative(ROOT, file).replace(/\\/g, "/"),
    source: readFileSync(file, "utf8"),
  }))
  .filter(({ source }) => MUTATES_MEDICINE.some((re) => re.test(source)));

describe("a medicine change refreshes the views that show it", () => {
  it("finds the medicine-mutating screens it claims to check", () => {
    // Guards the guard: patterns that matched nothing would pass for ever.
    expect(mutating.length).toBeGreaterThanOrEqual(4);
  });

  it("invalidates the medicine views from every screen that mutates one", () => {
    const missing = mutating
      .filter(({ rel }) => !EXEMPT[rel])
      .filter(({ source }) => !source.includes("invalidateMedicineViews"))
      .map(({ rel }) => rel);

    // If this fails: call invalidateMedicineViews(queryClient) after the
    // mutation, or add the file to EXEMPT above naming what refreshes instead.
    expect(missing).toEqual([]);
  });

  it("keeps every exemption pointing at a file that still exists and still mutates", () => {
    // A stale exemption is a hole that looks like a decision.
    const live = new Set(mutating.map((m) => m.rel));
    const dead = Object.keys(EXEMPT).filter((rel) => !live.has(rel));
    expect(dead).toEqual([]);
  });
});
