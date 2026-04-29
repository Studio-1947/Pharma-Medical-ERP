import { describe, it, expect, beforeEach } from "vitest";
import { TaxService } from "../tax.service";

describe("TaxService", () => {
  let svc: TaxService;

  beforeEach(() => {
    svc = new TaxService();
  });

  it("should calculate intra-state tax with precision (Test 1)", () => {
    // Input: 247.50 unit price, 1 qty, 0 discount, 12% tax
    const result = svc.calculateLineTax(247.50, 1, 0, 12, false);
    
    // 247.50 * 0.12 = 29.70
    // CGST = 14.85, SGST = 14.85
    expect(result.breakdown.cgst).toBe(14.85);
    expect(result.breakdown.sgst).toBe(14.85);
    expect(result.breakdown.totalTax).toBe(29.70);
    expect(result.lineTotal).toBe(277.20);
  });

  it("should calculate inter-state tax correctly (Test 2)", () => {
    // Input: 100 unit price, 2 qty, 10% discount, 18% tax
    // Taxable = 100 * 2 * 0.9 = 180
    // IGST = 180 * 0.18 = 32.40
    const result = svc.calculateLineTax(100, 2, 10, 18, true);
    
    expect(result.breakdown.igst).toBe(32.40);
    expect(result.breakdown.cgst).toBe(0);
    expect(result.breakdown.sgst).toBe(0);
    expect(result.lineTotal).toBe(212.40);
  });

  it("should handle zero tax correctly (Test 3)", () => {
    const result = svc.calculateLineTax(50, 3, 0, 0, false);
    
    expect(result.lineTotal).toBe(150);
    expect(result.breakdown.totalTax).toBe(0);
    expect(result.breakdown.cgst).toBe(0);
  });

  it("should handle discount + tax compound correctly (Test 4)", () => {
    // Input: 200 unit price, 1 qty, 5% discount, 12% tax
    // Taxable = 200 * 0.95 = 190
    // totalTax = 190 * 0.12 = 22.80
    const result = svc.calculateLineTax(200, 1, 5, 12, false);
    
    expect(result.breakdown.cgst).toBe(11.40);
    expect(result.breakdown.sgst).toBe(11.40);
    expect(result.lineTotal).toBe(212.80);
  });
});
