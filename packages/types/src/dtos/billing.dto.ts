import { z } from "zod";


export const recordPaymentSchema = z.object({
  invoiceId: z.string().uuid(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  mode: z.enum(["cash", "card", "upi", "insurance", "credit", "mixed"]),
  referenceNo: z.string().max(100).optional(),
});

export type RecordPaymentDto = z.infer<typeof recordPaymentSchema>;
