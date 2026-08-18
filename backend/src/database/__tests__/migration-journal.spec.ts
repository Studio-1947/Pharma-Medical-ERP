import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards the invariants that Drizzle's migrator silently depends on.
 *
 * The migrator does not record which migrations ran. It reads the single most
 * recent row of __drizzle_migrations and applies every journal entry whose
 * `when` exceeds that row's created_at:
 *
 *     if (!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis)
 *
 * Two consequences follow, and both have already bitten this repo:
 *
 *  1. A new entry whose `when` is below the highest already-applied `when` is
 *     skipped on every existing database, permanently. Re-deploying cannot fix
 *     it — the comparison is identical every time.
 *  2. Lowering the `when` of an already-released entry moves that high-water
 *     mark for anyone who has not deployed yet, so entries added afterwards
 *     land underneath it.
 *
 * PR #48 shipped 0030 at when=1786800100000. PR #49 lowered 0028-0030 and
 * appended 0031-0033 at 1786697030000-1786697050000, below that mark. All three
 * were skipped on production, leaving `app_settings` absent and the billing-flow
 * switch returning 42P01. 0036_repair_skipped_0031_0033 replays them.
 *
 * These tests fail before such a journal can be merged again.
 */

const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "drizzle", "migrations");

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

function readJournal(raw: string): JournalEntry[] {
  return (JSON.parse(raw) as { entries: JournalEntry[] }).entries;
}

const journal = readJournal(
  readFileSync(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"),
);

describe("drizzle migration journal", () => {
  it("has at least one entry", () => {
    expect(journal.length).toBeGreaterThan(0);
  });

  it("gives every entry a strictly greater `when` than the one before it", () => {
    const regressions = journal
      .map((entry, i) => ({ entry, prev: journal[i - 1] }))
      .filter(({ entry, prev }) => prev !== undefined && entry.when <= prev.when)
      .map(
        ({ entry, prev }) =>
          `${entry.tag} (when=${entry.when}) does not exceed ${prev!.tag} (when=${prev!.when})`,
      );

    expect(regressions).toEqual([]);
  });

  it("orders entries by idx", () => {
    expect(journal.map((e) => e.idx)).toEqual(journal.map((_, i) => i));
  });

  it("pairs every journal entry with a .sql file and vice versa", () => {
    const onDisk = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.replace(/\.sql$/, ""))
      .sort();
    const registered = journal.map((e) => e.tag).sort();

    // An unregistered .sql file never runs — runMigrations() only executes what
    // the journal lists. A registered file that is missing crashes the migrator.
    expect(registered).toEqual(onDisk);
  });

  it("never lowers or rewrites the `when` of an entry already on main", () => {
    let baseline: JournalEntry[];
    try {
      const raw = execFileSync(
        "git",
        ["show", "origin/main:backend/drizzle/migrations/meta/_journal.json"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
      baseline = readJournal(raw);
    } catch {
      // Shallow clone, no origin/main, or not a git checkout. The invariants
      // above still ran; this one simply has nothing to compare against.
      return;
    }

    const current = new Map(journal.map((e) => [e.tag, e.when]));
    const changed = baseline
      .filter((e) => current.has(e.tag) && current.get(e.tag) !== e.when)
      .map(
        (e) =>
          `${e.tag}: main has when=${e.when}, this branch has when=${current.get(e.tag)}`,
      );

    // A released `when` is already written into every deployed database's
    // __drizzle_migrations. Changing it here changes nothing there, and only
    // misleads the next person about which migrations will actually run.
    expect(changed).toEqual([]);
  });

  it("never removes or renames an entry already on main", () => {
    let baseline: JournalEntry[];
    try {
      const raw = execFileSync(
        "git",
        ["show", "origin/main:backend/drizzle/migrations/meta/_journal.json"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
      baseline = readJournal(raw);
    } catch {
      return;
    }

    const current = new Set(journal.map((e) => e.tag));
    const vanished = baseline
      .filter((e) => !current.has(e.tag))
      .map((e) => `${e.tag} is on main but no longer in this journal`);

    // A released migration is immutable. Renaming one makes drizzle treat it as
    // new and re-run it against every database that already applied it — which
    // is only survivable when the SQL happens to be idempotent, and silently
    // destructive when it is not. Deleting one is worse: fresh databases never
    // get it. Add a new migration instead of editing a released one.
    expect(vanished).toEqual([]);
  });

  it("gives new entries a `when` above every entry already on main", () => {
    let baseline: JournalEntry[];
    try {
      const raw = execFileSync(
        "git",
        ["show", "origin/main:backend/drizzle/migrations/meta/_journal.json"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
      baseline = readJournal(raw);
    } catch {
      return;
    }

    if (baseline.length === 0) return;
    const highWaterMark = Math.max(...baseline.map((e) => e.when));
    const knownTags = new Set(baseline.map((e) => e.tag));

    // This is the exact comparison the migrator makes against a database that
    // is up to date with main. Anything at or below the mark is dead on arrival.
    const deadOnArrival = journal
      .filter((e) => !knownTags.has(e.tag) && e.when <= highWaterMark)
      .map(
        (e) =>
          `${e.tag} (when=${e.when}) is at or below main's high-water mark ${highWaterMark} and would never run on an existing database`,
      );

    expect(deadOnArrival).toEqual([]);
  });
});
