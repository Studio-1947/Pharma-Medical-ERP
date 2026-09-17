import { describe, expect, it } from "vitest";
import { parseSupplierInvoiceText } from "../supplier-invoice-parser";

describe("supplier invoice OCR parser", () => {
  it("extracts billed and free quantities, batch, expiry and prices", () => {
    const text = "1. 10+1 100ML COKUF-L SYP BIO KPL26178C 1/28 30041050 125.00 95.25 4.00 2.50 2.50 952.50";
    expect(parseSupplierInvoiceText(text)).toEqual([
      expect.objectContaining({
        productName: "COKUF-L SYP",
        billedQty: 10,
        freeQty: 1,
        pack: "100ML",
        manufacturer: "BIO",
        batchNo: "KPL26178C",
        expiryDate: "2028-01-01",
        mrp: 125,
        rate: 95.25,
        discountPct: 4,
      }),
    ]);
  });

  it("ignores headers, totals and incomplete OCR lines", () => {
    expect(parseSupplierInvoiceText("GST INVOICE\nTOTAL 6419.90\n1 bad row")).toEqual([]);
  });
});
