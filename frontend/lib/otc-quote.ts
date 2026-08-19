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

/**
 * Unrounded running sums, kept so several medicines on one bill can be summed
 * the way the server sums them — per allocation — instead of rounding each
 * medicine's total and adding those.
 */
interface OtcQuoteInternal extends OtcQuote {
  /** Sum of the per-allocation rounded line totals, before the final rounding. */
  lineTotalSum: number;
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
}): OtcQuoteInternal {
  const size = Math.max(1, stripSize || 1);
  let remaining = Math.max(0, units);
  let subtotal = 0;
  let tax = 0;
  let lineTotalSum = 0;
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

    const lineTax = (taxable * taxPct) / 100;

    subtotal += r2(taxable);
    tax += r2(lineTax);
    // The server rounds the line total in one step (taxable + tax), not by
    // adding the two rounded halves, so a half-paisa on each does not become a
    // whole one here. See TaxService.calculateLineTax.
    lineTotalSum += r2(taxable + lineTax);
    used.push({ batchNo: b.batchNo, expiryDate: b.expiryDate, units: take });
    remaining -= take;
  }

  return {
    subtotal: r2(subtotal),
    tax: r2(tax),
    total: r2(lineTotalSum),
    lineTotalSum,
    used,
    short: remaining,
  };
}

export interface OtcQuoteLineInput {
  /** Sellable batches in FEFO order, as the dispense endpoint returns them. */
  batches: OtcQuoteBatch[];
  /** Quantity in the unit the invoice API speaks (packs x stripSize, or loose). */
  units: number;
  discountPct: number;
  taxPct: number;
  stripSize: number;
}

export interface OtcMultiQuote {
  /** Per-medicine quote, in the order the lines were given. */
  lines: OtcQuote[];
  subtotal: number;
  tax: number;
  total: number;
  /** Units across all lines that could not be allocated. */
  short: number;
}

/**
 * Prices a counter sale that carries several medicines on one bill.
 *
 * The server writes one invoice line per FEFO allocation across every item and
 * then aggregates (BillingService.createInTransaction → aggregateInvoiceTotals),
 * so the bill total is the sum of the per-allocation rounded figures — not the
 * sum of per-medicine totals rounded again. Summing this way keeps the tendered
 * amount equal to the server's to the paisa, which the invoice route insists on.
 */
export function quoteOtcSaleLines(lines: OtcQuoteLineInput[]): OtcMultiQuote {
  const quotes = lines.map((l) =>
    quoteOtcSale({
      batches: l.batches,
      units: l.units,
      discountPct: l.discountPct,
      taxPct: l.taxPct,
      stripSize: l.stripSize,
    }),
  );

  return {
    lines: quotes,
    subtotal: r2(quotes.reduce((s, q) => s + q.subtotal, 0)),
    tax: r2(quotes.reduce((s, q) => s + q.tax, 0)),
    total: r2(quotes.reduce((s, q) => s + q.lineTotalSum, 0)),
    short: quotes.reduce((s, q) => s + q.short, 0),
  };
}
