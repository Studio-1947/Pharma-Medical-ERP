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
   * Assumes intra-state (CGST + SGST). Pass interState=true for IGST.
   */
  calculateLineTax(
    unitPrice: number,
    quantity: number,
    discountPct: number,
    taxPct: number,
    interState = false,
  ): { lineTotal: number; taxAmount: number; breakdown: TaxBreakdown } {
    const gross = new Decimal(unitPrice).times(quantity);
    const discount = gross.times(discountPct).dividedBy(100);
    const taxableAmount = gross.minus(discount);
    const totalTax = taxableAmount.times(taxPct).dividedBy(100);
    const lineTotal = taxableAmount.plus(totalTax);
    const halfTax = totalTax.dividedBy(2);

    const breakdown: TaxBreakdown = interState
      ? {
          taxableAmount: taxableAmount.toNumber(),
          cgst: 0,
          sgst: 0,
          igst: totalTax.toNumber(),
          totalTax: totalTax.toNumber(),
        }
      : {
          taxableAmount: taxableAmount.toNumber(),
          cgst: halfTax.toNumber(),
          sgst: halfTax.toNumber(),
          igst: 0,
          totalTax: totalTax.toNumber(),
        };

    return { lineTotal: lineTotal.toNumber(), taxAmount: totalTax.toNumber(), breakdown };
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
    return { subtotal, taxAmount, totalAmount };
  }
}
