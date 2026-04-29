import { z } from "zod";

export const createPrescriptionSchema = z.object({
  patientId: z.string().uuid(),
  doctorName: z.string().min(1).max(255),
  doctorRegNo: z.string().max(100).optional(),
  hospitalName: z.string().max(255).optional(),
  issuedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().optional(),
  isControlled: z.boolean().default(false),
  items: z.array(z.object({
    medicineName: z.string().min(1).max(255),
    medicineId: z.string().uuid().optional(),
    dosage: z.string().max(100).optional(),
    frequency: z.string().max(100).optional(),
    duration: z.string().max(100).optional(),
    quantityPrescribed: z.number().int().min(1).optional(),
  })).optional(),
});

export const verifyPrescriptionSchema = z.object({
  action: z.enum(["verify", "reject"]),
  rejectionReason: z.string().optional(),
  items: z.array(z.object({
    id: z.string().uuid(),
    medicineId: z.string().uuid().optional(),
    medicineName: z.string().min(1),
    dosage: z.string().optional(),
    frequency: z.string().optional(),
    duration: z.string().optional(),
    quantityPrescribed: z.number().int().optional(),
  })).optional(),
}).refine((d) => d.action !== "reject" || !!d.rejectionReason, {
  message: "rejectionReason required when rejecting",
  path: ["rejectionReason"],
});

export const queryPrescriptionSchema = z.object({
  patientId: z.string().uuid().optional(),
  status: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreatePrescriptionDto = z.infer<typeof createPrescriptionSchema>;
export type VerifyPrescriptionDto = z.infer<typeof verifyPrescriptionSchema>;
export type QueryPrescriptionDto = z.infer<typeof queryPrescriptionSchema>;
