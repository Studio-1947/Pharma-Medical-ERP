import { Injectable } from "@nestjs/common";
import Decimal from "decimal.js";

export interface TaxBreakdown {
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
}

@Injectable()
export class TaxService {
  /**
   * Calculates GST for a retail line item (MRP is tax-inclusive as per Indian GST Rules).
   * Extracts taxable base value and tax amount from the final line total.
   * Splitting: Intra-state = CGST (50%) + SGST (50%); Inter-state = IGST (100%).
   */
  calculateLineTax(
    mrpUnitPrice: number,
    quantity: number,
    discountPct: number,
    taxPct: number,
    interState = false,
  ): { lineTotal: number; taxAmount: number; breakdown: TaxBreakdown } {
    const grossMrp = new Decimal(mrpUnitPrice).times(quantity);
    const discount = grossMrp.times(discountPct).dividedBy(100);
    const lineTotal = grossMrp.minus(discount);

    // Reverse GST Formula: Taxable Value = Line Total / (1 + GST% / 100)
    const gstRateFactor = new Decimal(1).plus(new Decimal(taxPct).dividedBy(100));
    const taxableAmount = lineTotal.dividedBy(gstRateFactor);
    const totalTax = lineTotal.minus(taxableAmount);

    const halfTax = totalTax.dividedBy(2);

    const breakdown: TaxBreakdown = interState
      ? {
          taxableAmount: taxableAmount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
          cgst: 0,
          sgst: 0,
          igst: totalTax.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
          totalTax: totalTax.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
        }
      : {
          taxableAmount: taxableAmount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
          cgst: halfTax.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
          sgst: halfTax.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
          igst: 0,
          totalTax: totalTax.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
        };

    return {
      lineTotal: lineTotal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
      taxAmount: totalTax.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
      breakdown,
    };
  }

  /**
   * Aggregates tax breakdowns from all line items into invoice totals.
   */
  aggregateInvoiceTotals(lines: { lineTotal: number; taxAmount: number; taxableAmount: number }[]) {
    const subtotal = lines.reduce(
      (s, l) => new Decimal(s).plus(l.taxableAmount).toNumber(),
      0,
    );
    const taxAmount = lines.reduce(
      (s, l) => new Decimal(s).plus(l.taxAmount).toNumber(),
      0,
    );
    const totalAmount = lines.reduce(
      (s, l) => new Decimal(s).plus(l.lineTotal).toNumber(),
      0,
    );
    return {
      subtotal: new Decimal(subtotal).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
      taxAmount: new Decimal(taxAmount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
      totalAmount: new Decimal(totalAmount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
    };
  }
}
