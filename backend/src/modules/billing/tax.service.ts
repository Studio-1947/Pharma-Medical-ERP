import { Injectable } from "@nestjs/common";

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
    const gross = unitPrice * quantity;
    const discount = (gross * discountPct) / 100;
    const taxableAmount = gross - discount;
    const totalTax = (taxableAmount * taxPct) / 100;
    const lineTotal = taxableAmount + totalTax;

    const breakdown: TaxBreakdown = interState
      ? { taxableAmount, cgst: 0, sgst: 0, igst: totalTax, totalTax }
      : { taxableAmount, cgst: totalTax / 2, sgst: totalTax / 2, igst: 0, totalTax };

    return { lineTotal, taxAmount: totalTax, breakdown };
  }

  /**
   * Aggregates tax breakdowns from all line items into invoice totals.
   */
  aggregateInvoiceTotals(lines: { lineTotal: number; taxAmount: number; taxableAmount: number }[]) {
    const subtotal = lines.reduce((s, l) => s + l.taxableAmount, 0);
    const taxAmount = lines.reduce((s, l) => s + l.taxAmount, 0);
    const totalAmount = lines.reduce((s, l) => s + l.lineTotal, 0);
    return { subtotal, taxAmount, totalAmount };
  }
}
