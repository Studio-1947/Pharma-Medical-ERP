/**
 * Helper to extract true client IP from x-forwarded-for header,
 * falling back to socket IP if header is missing or empty.
 */
export function extractClientIp(req: any): string {
  const forwarded = req?.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0]!.trim();
  }
  return req?.ip ?? "127.0.0.1";
}
