/**
 * The invoice-status groupings that business rules actually care about.
 *
 * `invoice_status` has six members and most rules care about a subset, so the
 * subsets were being spelled out inline at every call site. That is how
 * `partially_paid` — added later, for due billing — came to be missing from all
 * seven report queries and from the returns gate: each place had its own copy
 * of the list and none of them were updated together.
 *
 * Adding a status now means editing these lists once. Keep them as the only
 * definition; do not re-inline a status array at a call site.
 */

/** Every member of the `invoice_status` enum, for exhaustiveness checks. */
export type InvoiceStatus =
  | "draft"
  | "confirmed"
  | "paid"
  | "partially_paid"
  | "refunded"
  | "cancelled";

/**
 * Statuses that mean "the goods left the counter" — a completed supply.
 *
 * This is the set that belongs in revenue, GST and statutory registers. Under
 * GST a supply is taxable when it is made, not when it is paid for, so a credit
 * sale (`partially_paid`) counts exactly as much as a settled one. `confirmed`
 * is legacy: no current code path writes it to a sale, but historic rows and
 * every credit note carry it.
 *
 * `draft` is excluded (nothing handed over), as are `cancelled` (voided, stock
 * already returned) and `refunded`.
 */
export const SUPPLIED_INVOICE_STATUSES = [
  "confirmed",
  "paid",
  "partially_paid",
] as const satisfies readonly InvoiceStatus[];

/**
 * Statuses an invoice can be returned against.
 *
 * Identical to the supplied set, and deliberately a separate constant: a return
 * is only meaningful for goods that actually left the counter, but the two lists
 * answer different questions and could legitimately diverge (a decision to stop
 * accepting returns on unpaid credit sales would change this one alone).
 */
export const RETURNABLE_INVOICE_STATUSES = [
  "confirmed",
  "paid",
  "partially_paid",
] as const satisfies readonly InvoiceStatus[];

/** Mutable copy for Drizzle's `inArray`, which does not accept readonly tuples. */
export const suppliedInvoiceStatuses = (): InvoiceStatus[] => [
  ...SUPPLIED_INVOICE_STATUSES,
];

export function isReturnableStatus(status: string): boolean {
  return (RETURNABLE_INVOICE_STATUSES as readonly string[]).includes(status);
}
