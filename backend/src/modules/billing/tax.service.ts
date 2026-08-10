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
   * Calculates GST split for a line item.
   * If taxInclusive is false (default), unitPrice is tax-exclusive base price.
   * If taxInclusive is true, unitPrice is tax-inclusive MRP.
   */
  calculateLineTax(
    unitPrice: number,
    quantity: number,
    discountPct: number,
    taxPct: number,
    interState = false,
    taxInclusive = false,
  ): { lineTotal: number; taxAmount: number; breakdown: TaxBreakdown } {
    let taxableAmount: Decimal;
    let totalTax: Decimal;
    let lineTotal: Decimal;

    if (taxInclusive) {
      const grossMrp = new Decimal(unitPrice).times(quantity);
      const discount = grossMrp.times(discountPct).dividedBy(100);
      lineTotal = grossMrp.minus(discount);
      const gstRateFactor = new Decimal(1).plus(new Decimal(taxPct).dividedBy(100));
      taxableAmount = lineTotal.dividedBy(gstRateFactor);
      totalTax = lineTotal.minus(taxableAmount);
    } else {
      const gross = new Decimal(unitPrice).times(quantity);
      const discount = gross.times(discountPct).dividedBy(100);
      taxableAmount = gross.minus(discount);
      totalTax = taxableAmount.times(taxPct).dividedBy(100);
      lineTotal = taxableAmount.plus(totalTax);
    }

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
