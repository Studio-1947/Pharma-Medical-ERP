export interface SupplierInvoiceRow {
  sourceLine: string;
  productName: string;
  billedQty: number;
  freeQty: number;
  pack: string;
  manufacturer: string;
  batchNo: string;
  expiryDate: string;
  hsn: string;
  mrp: number;
  rate: number;
  discountPct: number;
  taxPct: number;
  amount: number;
}

export interface SupplierInvoiceMetadata {
  supplierName: string;
  gstNo: string;
  phone: string;
  address: string;
  invoiceNo: string;
  invoiceDate: string;
}

function expiryToDate(value: string): string {
  const match = value.match(/^(\d{1,2})[\/-](\d{2,4})$/);
  if (!match) return "";
  const month = Number(match[1]);
  const year = Number(match[2]) < 100 ? 2000 + Number(match[2]) : Number(match[2]);
  if (month < 1 || month > 12) return "";
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/**
 * Parses common Indian pharmaceutical distributor invoice rows. Values are
 * read from the stable numeric tail (expiry, HSN, MRP, rate, taxes, amount),
 * leaving product descriptions free to contain spaces and strengths.
 */
export function parseSupplierInvoiceText(text: string): SupplierInvoiceRow[] {
  const rows: SupplierInvoiceRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/[|]/g, " ").replace(/\s+/g, " ").trim();
    if (!line || !/^\d+[.)]?\s+/.test(line)) continue;
    const tokens = line.split(" ");
    const serial = tokens.shift();
    if (!serial || tokens.length < 12) continue;

    const qtyToken = tokens.shift()!;
    const qtyMatch = qtyToken.match(/^(\d+)(?:\+(\d+))?$/);
    if (!qtyMatch) continue;
    const pack = tokens.shift() ?? "";

    const amount = Number(tokens.pop());
    const cgstPct = Number(tokens.pop());
    const sgstPct = Number(tokens.pop());
    const discountPct = Number(tokens.pop());
    const rate = Number(tokens.pop());
    const mrp = Number(tokens.pop());
    const hsn = tokens.pop() ?? "";
    const expiryDate = expiryToDate(tokens.pop() ?? "");
    const batchNo = tokens.pop() ?? "";
    const manufacturer = tokens.pop() ?? "";
    const productName = tokens.join(" ").replace(/[^A-Za-z0-9+./%() -]/g, "").trim();

    if (!productName || !batchNo || !expiryDate || !Number.isFinite(mrp) || !Number.isFinite(rate)) continue;
    rows.push({
      sourceLine: raw,
      productName,
      billedQty: Number(qtyMatch[1]),
      freeQty: Number(qtyMatch[2] ?? 0),
      pack,
      manufacturer,
      batchNo: batchNo.toUpperCase(),
      expiryDate,
      hsn,
      mrp,
      rate,
      discountPct: Number.isFinite(discountPct) ? discountPct : 0,
      taxPct:
        Number.isFinite(cgstPct) && Number.isFinite(sgstPct)
          ? cgstPct + sgstPct
          : 0,
      amount: Number.isFinite(amount) ? amount : 0,
    });
  }
  return rows;
}

function invoiceDate(value: string): string {
  const match = value.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (!match) return "";
  const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
  return `${year}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[1])).padStart(2, "0")}`;
}

/** Best-effort header extraction; every value remains editable before posting. */
export function parseSupplierInvoiceMetadata(text: string): SupplierInvoiceMetadata {
  const compact = text.replace(/\s+/g, " ");
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const invoiceNo = compact.match(/(?:invoice|inv(?:oice)?)\s*(?:no\.?|#|:)\s*[:.-]?\s*([A-Z0-9/-]+)/i)?.[1] ?? "";
  const dateRaw = compact.match(/(?:invoice\s*)?date\s*[:.-]?\s*(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/i)?.[1] ?? "";
  const gstNo = compact.match(/(?:GSTIN|GST\s*No\.?)\s*[:.-]?\s*([0-9A-Z]{15})/i)?.[1] ?? "";
  const supplierName =
    lines.find((line) => /(?:distributor|pharma|medical|agency|enterprise|supplier)/i.test(line))
      ?.replace(/^(?:m\/s\.?\s*)/i, "") ?? "";
  const phone = compact.match(/(?:phone|ph\.?|mobile)\s*[:.-]?\s*([+()\d][+()\d\s-]{6,19})/i)?.[1]?.trim() ?? "";
  const supplierLine = lines.findIndex((line) => line === supplierName || line.includes(supplierName));
  const address = supplierLine >= 0 ? (lines[supplierLine + 1] ?? "") : "";
  return { supplierName, gstNo: gstNo.toUpperCase(), phone, address, invoiceNo, invoiceDate: invoiceDate(dateRaw) };
}
