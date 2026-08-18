import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SUPPLIED_INVOICE_STATUSES,
  RETURNABLE_INVOICE_STATUSES,
  suppliedInvoiceStatuses,
  isReturnableStatus,
} from "../invoice-status";

/**
 * `partially_paid` was added for due billing and then left out of every place
 * that enumerated statuses: all seven report queries and the returns gate. Each
 * had its own inline copy of the list, so there was no single edit that could
 * have kept them in step.
 *
 * The first block pins the meaning of each set. The second stops the inline
 * copies coming back, which is the only reason the drift went unnoticed.
 */

describe("supplied invoice statuses", () => {
  it("counts a credit sale as a supply", () => {
    // Under GST a supply is taxable when it is made, not when it is paid for.
    // Leaving this out understated output tax and hid Schedule H dispensing
    // from the statutory register.
    expect(SUPPLIED_INVOICE_STATUSES).toContain("partially_paid");
  });

  it("counts settled and legacy-confirmed sales", () => {
    expect(SUPPLIED_INVOICE_STATUSES).toContain("paid");
    expect(SUPPLIED_INVOICE_STATUSES).toContain("confirmed");
  });

  it("excludes statuses where nothing left the counter", () => {
    expect(SUPPLIED_INVOICE_STATUSES).not.toContain("draft");
    expect(SUPPLIED_INVOICE_STATUSES).not.toContain("cancelled");
    expect(SUPPLIED_INVOICE_STATUSES).not.toContain("refunded");
  });

  it("hands Drizzle a fresh mutable array each call", () => {
    const a = suppliedInvoiceStatuses();
    const b = suppliedInvoiceStatuses();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    a.push("draft");
    expect(suppliedInvoiceStatuses()).not.toContain("draft");
  });
});

describe("returnable invoice statuses", () => {
  it.each(["paid", "partially_paid", "confirmed"])("accepts %s", (s) => {
    expect(isReturnableStatus(s)).toBe(true);
  });

  it.each(["draft", "cancelled", "refunded", "", "PAID"])("refuses %s", (s) => {
    expect(isReturnableStatus(s)).toBe(false);
  });

  it("covers every status a completed supply can hold", () => {
    for (const s of SUPPLIED_INVOICE_STATUSES) {
      expect(RETURNABLE_INVOICE_STATUSES).toContain(s);
    }
  });
});

describe("no module re-inlines its own status list", () => {
  const SRC = join(__dirname, "..", "..", "..");

  const files = [
    "modules/reports/reports.service.ts",
    "modules/billing/billing.service.ts",
  ];

  it.each(files)("%s uses the shared constants", (rel) => {
    const source = readFileSync(join(SRC, rel), "utf8");
    // Any literal array pairing two invoice statuses is a second definition of
    // a set that already has one, and the next status added will miss it.
    const inlined = source.match(
      /\[\s*"(?:draft|confirmed|paid|partially_paid|refunded|cancelled)"\s*,\s*"(?:draft|confirmed|paid|partially_paid|refunded|cancelled)"/g,
    );
    expect(inlined ?? []).toEqual([]);
  });

  it("reports.service.ts filters every query through the shared set", () => {
    const source = readFileSync(join(SRC, "modules/reports/reports.service.ts"), "utf8");
    const guarded = source.match(/suppliedInvoiceStatuses\(\)/g) ?? [];
    const statusFilters = source.match(/inArray\(schema\.salesInvoices\.status/g) ?? [];

    expect(statusFilters.length).toBeGreaterThan(0);
    expect(guarded.length).toBe(statusFilters.length);
  });
});
