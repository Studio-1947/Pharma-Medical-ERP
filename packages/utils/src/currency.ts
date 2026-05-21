/** Format a number as Indian Rupees. e.g. 1234567 → "₹12.35L" */
export function formatINR(n: number, compact = false): string {
  if (compact) {
    if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(2)}Cr`;
    if (n >= 100_000) return `₹${(n / 100_000).toFixed(2)}L`;
    if (n >= 1_000) return `₹${(n / 1_000).toFixed(1)}K`;
  }
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);
}

/** Split GST into CGST/SGST (intrastate) or IGST (interstate). */
export function splitGST(
  taxableAmount: number,
  gstRate: number,
  interState: boolean,
): { cgst: number; sgst: number; igst: number; total: number } {
  const total = (taxableAmount * gstRate) / 100;
  if (interState) {
    return { cgst: 0, sgst: 0, igst: parseFloat(total.toFixed(2)), total: parseFloat(total.toFixed(2)) };
  }
  const half = parseFloat((total / 2).toFixed(2));
  return { cgst: half, sgst: half, igst: 0, total: parseFloat(total.toFixed(2)) };
}
