import { PHARMACY_PRINT_DETAILS, formatTokenNo } from "@pharmerp/types";

/**
 * Header of the printed receipt: queue token, logo lockup, legal name, address.
 *
 * Extracted out of the POS component so the generated markup can be asserted
 * directly. The receipt is written into a detached window via document.write,
 * which is otherwise impossible to test and easy to break silently, and it
 * carries the legal identity that appears on a tax invoice.
 */

export interface ReceiptHeaderOptions {
  /** Clinic queue token. Null/absent for walk-in sales, which have none. */
  tokenNo?: number | string | null;
  /** Origin for absolute asset URLs; the print window has no base URL of its own. */
  origin: string;
  /** Document kind, e.g. "Tax Invoice / Bill of Supply". */
  subtitle: string;
}

/** Styles for the markup produced by {@link buildReceiptHeaderHtml}. */
export const RECEIPT_HEADER_STYLES = `
  .brand { text-align:center; margin-bottom:6px; }
  .brand img { height:54px; width:auto; }
  .legal-name { text-align:center; font-size:16px; font-weight:800; letter-spacing:0.5px; margin-top:6px; }
  .legal-addr { text-align:center; font-size:11px; color:#555; margin-top:2px; line-height:1.5; }
  .token-box { text-align:center; margin:0 auto 10px; border:2px solid #111; border-radius:6px;
               padding:6px 14px; display:inline-block; }
  .token-label { font-size:10px; letter-spacing:1.5px; color:#555; text-transform:uppercase; }
  .token-value { font-size:24px; font-weight:900; letter-spacing:3px; line-height:1.1; }
  .token-wrap { text-align:center; }
`;

/** Minimal escaping for values interpolated into the generated document. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildReceiptHeaderHtml({
  tokenNo,
  origin,
  subtitle,
}: ReceiptHeaderOptions): string {
  const tokenLabel = formatTokenNo(tokenNo);

  // Omitted rather than emptied: a walk-in bill keeps the original spacing
  // instead of printing a blank box.
  const tokenBlock = tokenLabel
    ? `  <div class="token-wrap">
    <div class="token-box">
      <div class="token-label">Token No.</div>
      <div class="token-value">${esc(tokenLabel)}</div>
    </div>
  </div>
`
    : "";

  const name = esc(PHARMACY_PRINT_DETAILS.legalName);

  return `${tokenBlock}  <div class="brand">
    <img id="brand-logo" src="${esc(origin)}/logo-full.svg" alt="${name}"/>
  </div>
  <p class="legal-name">${name}</p>
  <p class="legal-addr">${esc(PHARMACY_PRINT_DETAILS.addressLine)}<br/>Ph: ${esc(PHARMACY_PRINT_DETAILS.phone)}</p>
  <p class="subtitle">${esc(subtitle)}</p>
`;
}
