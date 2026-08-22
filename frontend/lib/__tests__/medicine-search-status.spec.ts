import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

/**
 * Every medicine search in the app must be able to find a medicine whatever
 * its status.
 *
 * `GET /inventory/medicines` defaults to active-only, and a bulk import parks
 * every row whose MRP failed to parse as inactive. So a call site that omits
 * `isActive` silently cannot see thousands of real catalogue rows — the desk
 * reports "nothing found" for a medicine that is sitting in inventory, and
 * there is no way in from that screen to fix it.
 *
 * This is enforced by reading the source rather than by rendering, because the
 * failure is one missing parameter at a call site nobody thought about. A test
 * per screen would only ever cover the screens someone remembered; this covers
 * the ones they did not, including screens added later.
 */

const ROOT = join(__dirname, "..", "..");
const SCAN_DIRS = ["app", "components", "hooks", "queries", "lib"];

/** Call sites that legitimately want only active medicines, with the reason. */
const EXEMPT: Record<string, string> = {};

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

/**
 * Finds each `"/inventory/medicines"` list call and returns the slice of
 * source that carries its params, so the assertion can look for `isActive`
 * without depending on how the call happens to be formatted.
 */
function listCalls(source: string) {
  const calls: string[] = [];
  const needle = '"/inventory/medicines"';
  let from = 0;
  for (;;) {
    const at = source.indexOf(needle, from);
    if (at === -1) break;
    from = at + needle.length;
    // A detail/mutation call ends the path with a template or id segment; only
    // the bare collection path takes the isActive filter.
    calls.push(source.slice(at, at + 400));
  }
  return calls;
}

describe("medicine search reaches the whole catalogue", () => {
  const offenders: string[] = [];

  for (const dir of SCAN_DIRS) {
    for (const file of sourceFiles(dir)) {
      const source = readFileSync(file, "utf8");
      const rel = relative(ROOT, file).replace(/\\/g, "/");
      if (EXEMPT[rel]) continue;

      for (const call of listCalls(source)) {
        // Writes (POST) carry a body, not a query filter.
        if (/apiClient\.(post|put|patch|delete)/.test(call.slice(0, 40))) continue;
        if (!/params/.test(call)) continue;
        if (/isActive/.test(call)) continue;

        // The params may be built into a variable above the call rather than
        // written inline — medicine-list.tsx does this so its status dropdown
        // can feed the query. Follow that one hop before calling it a miss.
        // Plain indexOf, not a regex: a pattern that quietly matched nothing
        // would turn this whole guard into a no-op without anyone noticing.
        const named = /params\s*:\s*(\w+)/.exec(call);
        const varName = named ? named[1]! : "params";
        const declaredAt = Math.max(
          source.indexOf("const " + varName + " ="),
          source.indexOf("let " + varName + " ="),
        );
        if (declaredAt !== -1) {
          const body = source.slice(declaredAt, source.indexOf("}", declaredAt) + 1);
          if (body.includes("isActive")) continue;
        }

        offenders.push(rel);
      }
    }
  }

  it("passes isActive at every medicine list call site", () => {
    // If this fails, add `isActive: "all"` to the call — or, if the screen
    // genuinely wants active-only, add it to EXEMPT above with the reason.
    expect([...new Set(offenders)]).toEqual([]);
  });

  it("actually finds the call sites it claims to check", () => {
    // Guards the guard: a regex that matches nothing would pass silently for
    // ever, which is the classic way a source-scanning test rots.
    const found = SCAN_DIRS.flatMap((d) => sourceFiles(d)).filter((f) =>
      readFileSync(f, "utf8").includes('"/inventory/medicines"'),
    );
    expect(found.length).toBeGreaterThan(5);
  });
});
