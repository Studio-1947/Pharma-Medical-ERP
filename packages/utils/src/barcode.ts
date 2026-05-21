/** Validates a standard EAN-13 barcode checksum */
export function isValidEAN13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  const digits = code.split("").map(Number);
  const check = digits[12]!;
  const sum = digits.slice(0, 12).reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/** Extracts numeric prefix from a scanned barcode string (strips leading zeros). */
export function normalizeBarcodeInput(raw: string): string {
  return raw.trim().replace(/^0+/, "") || raw.trim();
}
