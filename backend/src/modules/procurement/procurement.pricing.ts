/**
 * Single source of truth for line-item cost math, used by both PO creation
 * (billable qty = orderedQty) and GRN receipt / bill display (billable qty =
 * receivedQty - freeQty). Discount is applied to unit cost before tax.
 */
export interface LineInput {
  unitCost: string | number;
  taxPct: string | number;
  discountPct?: string | number;
  qty: number;
}

export interface LineResult {
  lineCost: number;
  lineTax: number;
  lineTotal: number;
}

export function calculateLine({ unitCost, taxPct, discountPct = 0, qty }: LineInput): LineResult {
  const cost = typeof unitCost === "string" ? parseFloat(unitCost) : unitCost;
  const tax = typeof taxPct === "string" ? parseFloat(taxPct) : taxPct;
  const discount = typeof discountPct === "string" ? parseFloat(discountPct) : discountPct;

  const effectiveUnitCost = cost * (1 - discount / 100);
  const lineCost = effectiveUnitCost * qty;
  const lineTax = lineCost * (tax / 100);

  return { lineCost, lineTax, lineTotal: lineCost + lineTax };
}
