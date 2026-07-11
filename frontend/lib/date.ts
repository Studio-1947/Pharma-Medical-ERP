/**
 * Local calendar date as YYYY-MM-DD.
 *
 * Never use `new Date().toISOString().split("T")[0]` for business dates: that is
 * the UTC day, which in IST (UTC+5:30) rolls over 5.5 hours early, so tokens
 * created before ~05:30 IST would be stamped with the previous day.
 */
export function localDateString(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
