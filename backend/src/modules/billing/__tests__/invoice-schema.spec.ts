import { describe, it, expect } from "vitest";
import { createInvoiceSchema, invoiceItemSchema, paymentEntrySchema } from "@pharmerp/types";

/**
 * The checkout payload contract shared by the classic POS and the
 * patient-first counter desk.
 *
 * The critical rule: a consultation-only bill (doctor path on the counter
 * desk) legitimately carries an EMPTY items array — the fee is billed as a
 * GST-exempt service line. Any other empty-items invoice stays rejected.
 */
describe("createInvoiceSchema (checkout payload)", () => {
  const item = invoiceItemSchema.parse({
    medicineId: "11111111-1111-4111-8111-111111111111",
    quantity: 2,
  });
  const payment = paymentEntrySchema.parse({ mode: "cash", amount: "100.00" });

  it("accepts a normal medicine bill", () => {
    const parsed = createInvoiceSchema.parse({
      items: [item],
      payments: [payment],
    });
    expect(parsed.items).toHaveLength(1);
  });

  it("accepts an empty items array when a consultation fee is present", () => {
    const parsed = createInvoiceSchema.parse({
      items: [],
      consultationFee: { doctorName: "Dr. Rao", amount: "400.00" },
      payments: [payment],
    });
    expect(parsed.items).toHaveLength(0);
    expect(parsed.consultationFee!.doctorName).toBe("Dr. Rao");
  });

  it("rejects an empty items array without a consultation fee", () => {
    expect(() =>
      createInvoiceSchema.parse({ items: [], payments: [payment] }),
    ).toThrow(/At least one medicine or a consultation fee is required/);
  });

  it("rejects invoices with no payments", () => {
    expect(() =>
      createInvoiceSchema.parse({ items: [item], payments: [] }),
    ).toThrow();
  });

  it("keeps legacy defaults (discount, loyalty, offline sync)", () => {
    const parsed = createInvoiceSchema.parse({
      items: [item],
      payments: [payment],
    });
    expect(parsed.discountAmount).toBe("0");
    expect(parsed.loyaltyPointsToRedeem).toBe(0);
    expect(parsed.isOfflineSync).toBe(false);
  });
});
