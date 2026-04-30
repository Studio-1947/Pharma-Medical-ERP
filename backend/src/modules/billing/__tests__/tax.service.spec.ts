import { describe, it, expect } from "vitest";
import { TaxService } from "../tax.service";

describe("TaxService", () => {
  const service = new TaxService();

  describe("calculateLineTax", () => {
    it("should calculate correct intra-state tax for exact decimals (BILL-01)", () => {
      // 247.50 * 1 = 247.50
      // Tax 12% = 29.70
      // CGST = 14.85, SGST = 14.85
      const result = service.calculateLineTax(247.5, 1, 0, 12, false);
      
      expect(result.breakdown.cgst).toBe(14.85);
      expect(result.breakdown.sgst).toBe(14.85);
      expect(result.breakdown.cgst + result.breakdown.sgst).toBe(29.7);
      expect(result.lineTotal).toBe(277.2);
    });

    it("should handle quantity and discount without float drift", () => {
      // (100 * 3) - 10% = 270
      // Tax 18% = 48.60
      // Total = 318.60
      const result = service.calculateLineTax(100, 3, 10, 18, false);
      
      expect(result.breakdown.taxableAmount).toBe(270);
      expect(result.taxAmount).toBe(48.6);
      expect(result.lineTotal).toBe(318.6);
    });

    it("should return zero for zero price", () => {
      const result = service.calculateLineTax(0, 5, 0, 12, false);
      
      expect(result.lineTotal).toBe(0);
      expect(result.taxAmount).toBe(0);
      expect(result.breakdown.cgst).toBe(0);
      expect(result.breakdown.sgst).toBe(0);
    });

    it("should calculate correct inter-state tax (BILL-03)", () => {
      const result = service.calculateLineTax(100, 1, 0, 12, true);
      
      expect(result.breakdown.igst).toBe(12);
      expect(result.breakdown.cgst).toBe(0);
      expect(result.breakdown.sgst).toBe(0);
      expect(result.taxAmount).toBe(12);
    });

    it("should split tax equally for intra-state", () => {
      const result = service.calculateLineTax(100, 1, 0, 12, false);
      
      expect(result.breakdown.cgst).toBe(6);
      expect(result.breakdown.sgst).toBe(6);
      expect(result.breakdown.igst).toBe(0);
    });
  });

  describe("aggregateInvoiceTotals", () => {
    it("should sum multiple lines correctly", () => {
      const lines = [
        { lineTotal: 112, taxAmount: 12, taxableAmount: 100 },
        { lineTotal: 224, taxAmount: 24, taxableAmount: 200 },
      ];
      const result = service.aggregateInvoiceTotals(lines);
      
      expect(result.subtotal).toBe(300);
      expect(result.taxAmount).toBe(36);
      expect(result.totalAmount).toBe(336);
    });
  });
});
