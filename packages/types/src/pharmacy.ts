/**
 * Default identity for medicine invoices when older data has no branch detail.
 *
 * Lives in the shared package because the same details are rendered by the
 * frontend (POS receipt and on-screen invoice preview) and by the backend
 * (invoice PDF). These appear on tax invoices, so the
 * two sides drifting apart would be a compliance problem, not a cosmetic one.
 *
 * Medicine invoices normally use the selling branch record. This object is the
 * safe fallback for historical invoices and Store 1.
 */
export const PHARMACY_PRINT_DETAILS = {
  /** Store name used on medicine bills when branch data is unavailable. */
  legalName: "Radha Madhav Medical Hall",
  /** Trading name, matching the logo lockup. Used by the app UI, not by bills. */
  tradingName: "Radha Madhav Medical Hall",
  addressLine: "Krishna Nagar, Near Mirik BPHC, Mirik-734214",
  phone: "73844 57427, 97759 31980",
} as const;

/** Clinic identity used only on doctor prescriptions and clinic documents. */
export const CLINIC_PRINT_DETAILS = {
  legalName: "Shree Radha Madhav Medical Hall",
  addressLine: PHARMACY_PRINT_DETAILS.addressLine,
  phone: PHARMACY_PRINT_DETAILS.phone,
} as const;

/** Convenience for single-line contexts such as PDF metadata. */
export const PHARMACY_ADDRESS_ONELINE = `${PHARMACY_PRINT_DETAILS.addressLine} | Ph: ${PHARMACY_PRINT_DETAILS.phone}`;

/**
 * Formats a clinic queue token for display, e.g. 42 -> "042".
 *
 * Returns null when there is no token, which is the normal case for a walk-in
 * pharmacy sale. Callers use null to omit the token row entirely rather than
 * printing an empty field.
 */
export function formatTokenNo(
  tokenNo: number | string | null | undefined,
): string | null {
  if (tokenNo === null || tokenNo === undefined || tokenNo === "") return null;
  const n = typeof tokenNo === "number" ? tokenNo : Number(tokenNo);
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(Math.trunc(n)).padStart(3, "0");
}
