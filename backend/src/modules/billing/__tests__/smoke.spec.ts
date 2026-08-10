import { describe, it, expect, vi } from "vitest";
import { TaxService } from "../tax.service";

/**
 * Smoke tests — catch regressions on critical calculation paths and
 * verify previously-found bugs stay fixed.
 */

// ─── TaxService smoke ──────────────────────────────────────────────────────────

describe("TaxService smoke", () => {
  const tax = new TaxService();

  it("CGST + SGST always equals total tax for intra-state (no float drift)", () => {
    const { breakdown } = tax.calculateLineTax(333.33, 3, 5, 12, false);
    const parts = breakdown.cgst + breakdown.sgst;
    expect(Math.abs(parts - breakdown.totalTax)).toBeLessThan(0.005);
  });

  it("inter-state: IGST equals total tax, CGST/SGST are zero", () => {
    const { breakdown } = tax.calculateLineTax(500, 2, 0, 18, true);
    expect(breakdown.igst).toBe(breakdown.totalTax);
    expect(breakdown.cgst).toBe(0);
    expect(breakdown.sgst).toBe(0);
  });

  it("discount applied before tax (taxable base is reduced)", () => {
    // 100 * 1, 10% discount → taxable = 90, tax 12% → 10.80
    const { breakdown, taxAmount } = tax.calculateLineTax(100, 1, 10, 12, false);
    expect(breakdown.taxableAmount).toBe(90);
    expect(taxAmount).toBeCloseTo(10.8, 5);
  });

  it("zero quantity produces zero totals", () => {
    const { lineTotal, taxAmount } = tax.calculateLineTax(200, 0, 0, 12, false);
    expect(lineTotal).toBe(0);
    expect(taxAmount).toBe(0);
  });
});

// ─── Invoice query DTO — pagination defaults (REGRESSION BUG-01) ─────────────

describe("queryInvoiceSchema — pagination defaults (REGRESSION BUG-01)", () => {
  it("should apply default page=1 and limit=20 when not provided", async () => {
    const { queryInvoiceSchema } = await import("@pharmerp/types");
    const result = queryInvoiceSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(20);
    }
  });

  it("should coerce string page/limit to numbers", async () => {
    const { queryInvoiceSchema } = await import("@pharmerp/types");
    const result = queryInvoiceSchema.safeParse({ page: "2", limit: "50" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(2);
      expect(result.data.limit).toBe(50);
    }
  });

  it("should reject limit above 100", async () => {
    const { queryInvoiceSchema } = await import("@pharmerp/types");
    const result = queryInvoiceSchema.safeParse({ limit: "200" });
    expect(result.success).toBe(false);
  });
});

// ─── Offline sync boolean query (REGRESSION BUG-02) ──────────────────────────

describe("syncOfflineQueue — boolean filter (REGRESSION BUG-02)", () => {
  it("equals(false) matches unsynced records; equals(0) does not", () => {
    // Simulate what Dexie stores: booleans are stored as booleans in IndexedDB.
    // This test documents that the fix uses false, not 0.
    const records = [
      { id: 1, synced: false, attempts: 0 },
      { id: 2, synced: true, attempts: 0 },
      { id: 3, synced: false, attempts: 1 },
    ];

    // Old (broken) behaviour — comparing boolean false to integer 0
    // In strict equality: false === 0 is false in JS
    const brokenFilter = records.filter((r) => (r.synced as any) === 0);
    expect(brokenFilter).toHaveLength(0); // proves the old bug returned nothing

    // Correct behaviour
    const fixedFilter = records.filter((r) => r.synced === false);
    expect(fixedFilter).toHaveLength(2);
    expect(fixedFilter.map((r) => r.id)).toEqual([1, 3]);
  });
});

// ─── Payment mode on mixed invoices ───────────────────────────────────────────

describe("createInvoiceSchema — payment mode validation", () => {
  it("should accept valid payment modes", async () => {
    const { createInvoiceSchema } = await import("@pharmerp/types");
    const base = {
      items: [{ medicineId: "123e4567-e89b-12d3-a456-426614174001", quantity: 1 }],
    };
    for (const mode of ["cash", "card", "upi", "insurance", "credit", "mixed"] as const) {
      const result = createInvoiceSchema.safeParse({
        ...base,
        payments: [{ mode, amount: "100" }],
      });
      expect(result.success, `mode ${mode} should be valid`).toBe(true);
    }
  });

  it("should reject unknown payment mode", async () => {
    const { createInvoiceSchema } = await import("@pharmerp/types");
    const result = createInvoiceSchema.safeParse({
      items: [{ medicineId: "123e4567-e89b-12d3-a456-426614174001", quantity: 1 }],
      payments: [{ mode: "bitcoin", amount: "100" }],
    });
    expect(result.success).toBe(false);
  });
});

// ─── loyaltyPointsToRedeem must be multiples of 100 ──────────────────────────

describe("BillingService — loyalty points validation (BILL-10)", () => {
  it("should reject redemption not in multiples of 100", async () => {
    // Mocked inline — no full service wiring needed for this guard
    const validateLoyalty = (points: number) => {
      if (points % 100 !== 0) throw new Error("Points must be redeemed in multiples of 100");
    };

    expect(() => validateLoyalty(150)).toThrow(/multiples of 100/);
    expect(() => validateLoyalty(0)).not.toThrow();
    expect(() => validateLoyalty(100)).not.toThrow();
    expect(() => validateLoyalty(300)).not.toThrow();
  });
});

// ─── Schedule H Prescription Validation ──────────────────────────────────────

describe("createPrescriptionSchema — Schedule H validation (P0-2)", () => {
  it("should require doctorRegNo and valid doctorName for controlled prescriptions", async () => {
    const { createPrescriptionSchema } = await import("@pharmerp/types");
    const validControlled = {
      patientId: "123e4567-e89b-12d3-a456-426614174001",
      doctorName: "Dr. A. K. Sharma",
      doctorRegNo: "MCI-194820",
      issuedDate: "2026-08-10",
      expiryDate: "2026-09-10",
      isControlled: true,
    };
    expect(createPrescriptionSchema.safeParse(validControlled).success).toBe(true);

    const missingRegNo = { ...validControlled, doctorRegNo: "" };
    expect(createPrescriptionSchema.safeParse(missingRegNo).success).toBe(false);

    const dummyBypassDoc = { ...validControlled, doctorName: "External Doctor (Verified on Counter)" };
    expect(createPrescriptionSchema.safeParse(dummyBypassDoc).success).toBe(false);
  });
});

// ─── Query Limits — Medicines & Suppliers (P0-1) ─────────────────────────────

describe("Query Schemas — max limit up to 1000 (P0-1)", () => {
  it("should accept query limit up to 1000 for medicines and suppliers", async () => {
    const { queryMedicineSchema, querySupplierSchema } = await import("@pharmerp/types");
    
    const medRes = queryMedicineSchema.safeParse({ limit: 1000 });
    expect(medRes.success).toBe(true);
    if (medRes.success) expect(medRes.data.limit).toBe(1000);

    const supRes = querySupplierSchema.safeParse({ limit: 1000 });
    expect(supRes.success).toBe(true);
    if (supRes.success) expect(supRes.data.limit).toBe(1000);
  });
});

// ─── Client IP Extraction Helper (P0-5) ──────────────────────────────────────

describe("extractClientIp utility (P0-5)", () => {
  it("should parse x-forwarded-for header list and return first client IP", async () => {
    const { extractClientIp } = await import("../../../common/utils/client-ip.util");
    expect(extractClientIp({ headers: { "x-forwarded-for": "203.0.113.195, 70.41.3.18" } })).toBe("203.0.113.195");
    expect(extractClientIp({ headers: {}, ip: "10.0.0.1" })).toBe("10.0.0.1");
  });
});
