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
   *
   * If taxInclusive is false (default), unitPrice is a tax-exclusive base price.
   * If taxInclusive is true, unitPrice is a tax-inclusive price.
   *
   * THIS PHARMACY PRICES TAX-EXCLUSIVE, so every caller leaves the flag at
   * false and GST is added on top. Confirmed with the business on 2026-08-18:
   * the figure staff enter as "MRP" during goods receipt does not include tax.
   *
   * Flagging this because it reads like a bug and is not: the field is called
   * mrpAtEntry, and a printed MRP in India normally is tax-inclusive, so an
   * audit will keep arriving at "we are billing above MRP". We are not — the
   * column holds a pre-tax price under a misleading name. Do not switch the
   * flag without asking the business first; doing so silently cuts every line
   * by the GST rate. Renaming the column would be the real fix.
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
   * Spreads an invoice-level discount across the lines and re-taxes them.
   *
   * Per-line discountPct was always handled correctly — calculateLineTax applies
   * it before working out the tax. An invoice-level discount was not: it was
   * subtracted from the total *after* the tax had been computed, so GST was
   * charged on money the patient never paid. The printed bill still balanced
   * (subtotal − discount + tax = total), which is why it went unnoticed; the
   * overstatement only surfaced in the GST return.
   *
   * Shares are apportioned by taxable value and settled in paise using the
   * largest-remainder method, so they sum to the discount exactly instead of
   * leaving a rounding crumb that makes the line GST disagree with the invoice
   * GST — the kind of mismatch that fails a GSTR-1 reconciliation.
   *
   * A discount larger than the taxable base is capped: the excess belongs to
   * GST-exempt value (a consultation fee) and must not create negative tax.
   */
  apportionDiscountAcrossLines<T extends { taxableAmount: number; taxPct: number }>(
    lines: T[],
    discountAmount: number,
    interState = false,
  ): Array<{
    discountShare: number;
    taxableAmount: number;
    taxAmount: number;
    lineTotal: number;
    breakdown: TaxBreakdown;
  }> {
    const base = lines.reduce(
      (sum, l) => sum.plus(l.taxableAmount),
      new Decimal(0),
    );
    const requested = new Decimal(discountAmount);
    const effective = Decimal.min(
      Decimal.max(requested, 0),
      Decimal.max(base, 0),
    );

    // Work in paise so the apportionment is exact integer arithmetic.
    const totalPaise = effective.times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    let shares: Decimal[];

    if (base.lessThanOrEqualTo(0) || totalPaise.lessThanOrEqualTo(0)) {
      shares = lines.map(() => new Decimal(0));
    } else {
      const exact = lines.map((l) =>
        totalPaise.times(l.taxableAmount).dividedBy(base),
      );
      const floors = exact.map((e) => e.floor());
      let assigned = floors.reduce((s, f) => s.plus(f), new Decimal(0));

      // Hand the leftover paise to the largest fractional parts first.
      const order = exact
        .map((e, i) => ({ i, frac: e.minus(floors[i]!) }))
        .sort((a, b) => b.frac.comparedTo(a.frac));

      const result = [...floors];
      let k = 0;
      while (assigned.lessThan(totalPaise) && order.length > 0) {
        const idx = order[k % order.length]!.i;
        result[idx] = result[idx]!.plus(1);
        assigned = assigned.plus(1);
        k++;
      }
      shares = result.map((p) => p.dividedBy(100));
    }

    return lines.map((l, i) => {
      const share = shares[i]!;
      const taxable = new Decimal(l.taxableAmount).minus(share);
      const totalTax = taxable.times(l.taxPct).dividedBy(100);
      const half = totalTax.dividedBy(2);
      const r = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

      return {
        discountShare: r(share),
        taxableAmount: r(taxable),
        taxAmount: r(totalTax),
        lineTotal: r(taxable.plus(totalTax)),
        breakdown: interState
          ? { taxableAmount: r(taxable), cgst: 0, sgst: 0, igst: r(totalTax), totalTax: r(totalTax) }
          : { taxableAmount: r(taxable), cgst: r(half), sgst: r(half), igst: 0, totalTax: r(totalTax) },
      };
    });
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
