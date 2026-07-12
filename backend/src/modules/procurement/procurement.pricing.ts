import Decimal from "decimal.js";

/**
 * Single source of truth for line-item cost math, used by both PO creation
 * (billable qty = orderedQty) and GRN receipt / bill display (billable qty =
 * receivedQty - freeQty). Discount is applied to unit cost before tax.
 *
 * Returns Decimal, not number: these figures feed supplier balances and the
 * ledger, which accumulate across many rows, so binary floating point drift
 * would compound into real money. Callers round with .toFixed(2) only at the
 * persistence/display boundary. Same discipline as billing's TaxService.
 */
export interface LineInput {
  unitCost: string | number;
  taxPct: string | number;
  discountPct?: string | number;
  qty: number;
}

export interface LineResult {
  lineCost: Decimal;
  lineTax: Decimal;
  lineTotal: Decimal;
}

export function calculateLine({ unitCost, taxPct, discountPct = 0, qty }: LineInput): LineResult {
  const cost = new Decimal(unitCost);
  const tax = new Decimal(taxPct);
  const discount = new Decimal(discountPct);

  const effectiveUnitCost = cost.times(new Decimal(1).minus(discount.dividedBy(100)));
  const lineCost = effectiveUnitCost.times(qty);
  const lineTax = lineCost.times(tax).dividedBy(100);

  return { lineCost, lineTax, lineTotal: lineCost.plus(lineTax) };
}
