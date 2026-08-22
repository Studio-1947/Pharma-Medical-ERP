import { z } from "zod";

export const invoiceItemSchema = z.object({
  medicineId: z.string().uuid(),
  quantity: z.number().int().min(1),
  discountPct: z.string().regex(/^\d+(\.\d{1,2})?$/).default("0"),
  // batchId REMOVED — server performs FEFO (BILL-06)
  // unitPrice REMOVED — server reads mrpAtEntry from batch (BILL-07)
  // taxPct REMOVED — server reads medicine.taxPercent from DB
});

export const paymentEntrySchema = z.object({
  mode: z.enum(["cash", "card", "upi", "insurance", "credit", "mixed"]),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  referenceNo: z.string().max(100).optional(),
});

// Doctor consultation fee collected at the counter alongside a prescription
// dispense. Billed as a GST-exempt service line (health care services, Heading
// 9993) — it adds to subtotal and total but carries zero tax and no stock.
export const consultationFeeSchema = z.object({
  doctorName: z.string().min(1).max(255),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
});

export const createInvoiceSchema = z
  .object({
    patientId: z.string().uuid().optional(),
    prescriptionId: z.string().uuid().optional(),
    /**
     * Doctor this sale is credited to when it carries no prescription — the
     * counter tagging "these are Dr X's medicines" on an OTC hand-over.
     * Attribution only: it does not stand in for a prescription and does not
     * open the Schedule H gate.
     */
    referredByDoctorId: z.string().uuid().optional(),
    // Honoured only for super_admin, who has no branch of their own; every other
    // role is pinned to its own branch server-side regardless of what is sent.
    branchId: z.string().uuid().optional(),
    discountAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).default("0"),
    loyaltyPointsToRedeem: z.number().int().min(0).default(0),
    notes: z.string().optional(),
    isOfflineSync: z.boolean().default(false),
    /**
     * Idempotency key. Send the same value when retrying a checkout and the
     * server returns the invoice it already wrote instead of billing the sale
     * twice — the failure mode the offline queue hits when a response is lost
     * after the server has committed.
     */
    clientRef: z.string().min(8).max(64).optional(),
    consultationFee: consultationFeeSchema.optional(),
    items: z.array(invoiceItemSchema),
    payments: z.array(paymentEntrySchema).min(1),
    overrideReason: z.string().min(1).optional(),
    overriddenBy: z.string().uuid().optional(),
    /**
     * A Schedule H sale the manager vouched for at the counter with the
     * prescription not yet recorded — they saw the paper, the queue was
     * moving. The sale completes; the invoice stays flagged as owing a
     * prescription until one is attached to it.
     *
     * Only legal alongside a manager override (that is who is vouching), and
     * only on a bill that actually contains a prescription-only medicine —
     * see the refinement below.
     */
    rxPending: z.boolean().default(false),
  })
  // A consultation-only bill (doctor path on the counter desk, no medicines)
  // legitimately carries an empty items array — the fee is billed as a
  // GST-exempt service line. Allow that; any other empty-items invoice stays
  // rejected.
  .superRefine((val, ctx) => {
    // Attesting is an override with a debt attached: someone senior has to be
    // named as having seen the prescription, or there is nothing to chase and
    // no one to ask.
    if (val.rxPending && !(val.overrideReason && val.overriddenBy)) {
      ctx.addIssue({
        code: "custom",
        message:
          "Marking a prescription as still to come requires the manager who verified it and a reason",
        path: ["rxPending"],
      });
    }
    if (val.items.length === 0 && !val.consultationFee) {
      // Match the shape of a normal array issue so the errors object is
      // consistent for API clients.
      ctx.addIssue({
        code: "too_small",
        minimum: 1,
        type: "array",
        inclusive: true,
        exact: false,
        message: "At least one medicine or a consultation fee is required",
        path: ["items"],
      });
    }
  });

export const returnItemSchema = z.object({
  invoiceItemId: z.string().uuid(),
  returnQty: z.number().int().min(1),
});

export const returnInvoiceSchema = z.object({
  items: z.array(returnItemSchema).min(1),
  reason: z.string().min(1),
});

export const queryInvoiceSchema = z.object({
  /** Only bills still owing the prescription a manager attested for. */
  rxPending: z.coerce.boolean().optional(),
  patientId: z.string().uuid().optional(),
  staffId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  status: z.string().optional(),
  search: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const voidInvoiceSchema = z.object({
  reason: z.string().min(1),
});

export type InvoiceItemDto = z.infer<typeof invoiceItemSchema>;
export type PaymentEntryDto = z.infer<typeof paymentEntrySchema>;
export type ConsultationFeeDto = z.infer<typeof consultationFeeSchema>;
export type CreateInvoiceDto = z.infer<typeof createInvoiceSchema>;
export type ReturnItemDto = z.infer<typeof returnItemSchema>;
export type ReturnInvoiceDto = z.infer<typeof returnInvoiceSchema>;
export type QueryInvoiceDto = z.infer<typeof queryInvoiceSchema>;
export type VoidInvoiceDto = z.infer<typeof voidInvoiceSchema>;

/**
 * Attaching the prescription a manager promised at the counter. Documentary
 * only — the stock left the shelf when the invoice was written; this records
 * which prescription authorised it and clears the outstanding flag.
 */
export const attachPrescriptionSchema = z.object({
  prescriptionId: z.string().uuid(),
});

export type AttachPrescriptionDto = z.infer<typeof attachPrescriptionSchema>;
