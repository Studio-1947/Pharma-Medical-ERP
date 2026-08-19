/**
 * Pricing preview for a single-medicine OTC counter sale.
 *
 * The invoice route rejects both an over-payment and an under-paid walk-in, so
 * the amount the counter tenders has to be the amount the server computes to
 * the paisa. This mirrors the server's arithmetic exactly:
 *
 *   - FEFO allocation over the branch's sellable batches, in expiry order,
 *     splitting across batches when one runs short
 *     (BatchRepository.selectBatchesForDispenseMulti)
 *   - per-unit price = batch.mrpAtEntry / medicine.stripSize, pre-tax
 *     (BillingService.createInTransaction — mrpAtEntry holds a tax-exclusive
 *     price despite the name; see TaxService.calculateLineTax)
 *   - discount comes off before GST, per line, then each line's taxable value
 *     and tax are rounded half-up to 2dp (TaxService.calculateLineTax)
 *   - the invoice total is the rounded sum of those rounded line figures
 *     (TaxService.aggregateInvoiceTotals)
 *
 * Kept out of the modal so it can be tested against the server's TaxService —
 * see backend/src/modules/billing/__tests__/otc-quote-parity.spec.ts, which
 * runs the same case table through the real service.
 */

export interface OtcQuoteBatch {
  batchNo: string;
  quantity: number | string;
  reservedQty?: number | string | null;
  mrpAtEntry: number | string;
  expiryDate?: string | null;
}

export interface OtcQuote {
  subtotal: number;
  tax: number;
  total: number;
  used: { batchNo: string; expiryDate?: string | null; units: number }[];
  /** Units that could not be allocated — non-zero means insufficient stock. */
  short: number;
}

/** Half-up to 2dp — matches Decimal.ROUND_HALF_UP on the server. */
export function r2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function quoteOtcSale({
  batches,
  units,
  discountPct,
  taxPct,
  stripSize,
}: {
  /** Sellable batches in FEFO order, as the dispense endpoint returns them. */
  batches: OtcQuoteBatch[];
  /** Quantity in the unit the invoice API speaks (packs x stripSize, or loose). */
  units: number;
  discountPct: number;
  taxPct: number;
  stripSize: number;
}): OtcQuote {
  const size = Math.max(1, stripSize || 1);
  let remaining = Math.max(0, units);
  let subtotal = 0;
  let tax = 0;
  const used: OtcQuote["used"] = [];

  for (const b of batches) {
    if (remaining <= 0) break;
    const sellable = Math.max(
      0,
      Number(b.quantity ?? 0) - Number(b.reservedQty ?? 0),
    );
    if (sellable <= 0) continue;

    const take = Math.min(sellable, remaining);
    const unitPrice = Number(b.mrpAtEntry ?? 0) / size;
    const gross = unitPrice * take;
    const taxable = gross - (gross * discountPct) / 100;

    subtotal += r2(taxable);
    tax += r2((taxable * taxPct) / 100);
    used.push({ batchNo: b.batchNo, expiryDate: b.expiryDate, units: take });
    remaining -= take;
  }

  const sub = r2(subtotal);
  const tx = r2(tax);
  return { subtotal: sub, tax: tx, total: r2(sub + tx), used, short: remaining };
}
