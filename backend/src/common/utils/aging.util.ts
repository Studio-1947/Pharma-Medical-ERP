import { differenceInCalendarDays } from "date-fns";
import Decimal from "decimal.js";

/**
 * The aging ladder shared by both money reports: one "not yet due" column
 * followed by four past-due bands. Payables (supplier bills) and receivables
 * (customer invoices) bucket into the same ladder deliberately — the two
 * screens sit next to each other on a cash-position review, and columns that
 * did not line up would have to be mentally translated every time.
 */
export const AGING_BUCKETS = [
  { key: "current", label: "Not due" },
  { key: "d1_30", label: "1-30 days" },
  { key: "d31_60", label: "31-60 days" },
  { key: "d61_90", label: "61-90 days" },
  { key: "d90plus", label: "90+ days" },
] as const;

export type AgingBucketKey = (typeof AGING_BUCKETS)[number]["key"];

/** The four bands that represent money already late. */
export const OVERDUE_BUCKET_KEYS: AgingBucketKey[] = ["d1_30", "d31_60", "d61_90", "d90plus"];

export type BucketTotals = Record<AgingBucketKey, Decimal>;

/**
 * Whole calendar days past `dueDate` as of `asOf`, floored at zero.
 * Calendar days rather than elapsed hours: a bill due at 4pm today should
 * read 0 days late all day, and 1 tomorrow morning — not 0.7.
 */
export function daysPastDue(dueDate: Date, asOf: Date): number {
  return Math.max(0, differenceInCalendarDays(asOf, dueDate));
}

export function bucketFor(daysOverdue: number): AgingBucketKey {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "d1_30";
  if (daysOverdue <= 60) return "d31_60";
  if (daysOverdue <= 90) return "d61_90";
  return "d90plus";
}

export function newBucketTotals(): BucketTotals {
  return {
    current: new Decimal(0),
    d1_30: new Decimal(0),
    d31_60: new Decimal(0),
    d61_90: new Decimal(0),
    d90plus: new Decimal(0),
  };
}

export function addToBucket(totals: BucketTotals, daysOverdue: number, amount: Decimal): void {
  const key = bucketFor(daysOverdue);
  totals[key] = totals[key].plus(amount);
}

export function mergeBucketTotals(into: BucketTotals, from: BucketTotals): void {
  for (const { key } of AGING_BUCKETS) {
    into[key] = into[key].plus(from[key]);
  }
}

/** Fixed-scale strings, matching how every other money value crosses the API. */
export function serializeBuckets(totals: BucketTotals): Record<AgingBucketKey, string> {
  return {
    current: totals.current.toFixed(2),
    d1_30: totals.d1_30.toFixed(2),
    d31_60: totals.d31_60.toFixed(2),
    d61_90: totals.d61_90.toFixed(2),
    d90plus: totals.d90plus.toFixed(2),
  };
}

export function sumBuckets(totals: BucketTotals): Decimal {
  return AGING_BUCKETS.reduce((sum, { key }) => sum.plus(totals[key]), new Decimal(0));
}

export function sumOverdue(totals: BucketTotals): Decimal {
  return OVERDUE_BUCKET_KEYS.reduce((sum, key) => sum.plus(totals[key]), new Decimal(0));
}

/** Bucket list with amounts, for a UI that renders the ladder as columns. */
export function bucketBreakdown(totals: BucketTotals) {
  return AGING_BUCKETS.map(({ key, label }) => ({
    key,
    label,
    amount: totals[key].toFixed(2),
  }));
}
