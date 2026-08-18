/**
 * Legal identity printed on patient-facing documents.
 *
 * Lives in the shared package because the same details are rendered by the
 * frontend (POS receipt, on-screen invoice preview, prescription, public record
 * page) and by the backend (invoice PDF). These appear on tax invoices, so the
 * two sides drifting apart would be a compliance problem, not a cosmetic one.
 *
 * Note this is deliberately NOT the same string as the application's own name.
 * Printed documents carry the honorific "Shree"; the app UI, browser tab and
 * installed PWA use the plain trading name, matching the logo artwork.
 */
export const PHARMACY_PRINT_DETAILS = {
  /** Legal name as it must appear on bills, receipts and prescriptions. */
  legalName: "Shree Radha Madhav Medical Hall",
  /** Trading name, matching the logo lockup. Used by the app UI, not by bills. */
  tradingName: "Radha Madhav Medical Hall",
  addressLine: "Krishna Nagar, Near Mirik BPHC, Mirik-734214",
  phone: "73844 57427, 97759 31980",
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
