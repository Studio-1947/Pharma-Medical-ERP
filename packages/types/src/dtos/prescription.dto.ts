import { z } from "zod";

export const basePrescriptionSchema = z.object({
  patientId: z.string().uuid(),
  branchId: z.string().uuid().optional(),
  doctorName: z.string().min(1).max(255),
  doctorRegNo: z.string().max(100).optional(),
  hospitalName: z.string().max(255).optional(),
  issuedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().optional(),
  isControlled: z.boolean().default(false),
  fileUrl: z.string().optional(),
  physicalRegisterNo: z.string().max(100).optional(),
  items: z.array(z.object({
    medicineName: z.string().min(1).max(255),
    medicineId: z.string().uuid().optional(),
    dosage: z.string().max(100).optional(),
    frequency: z.string().max(100).optional(),
    duration: z.string().max(100).optional(),
    quantityPrescribed: z.number().int().min(1).optional(),
  })).optional(),
});

export const createPrescriptionSchema = basePrescriptionSchema.refine(
  (data) => {
    if (data.isControlled) {
      if (!data.doctorRegNo || !data.doctorRegNo.trim() || data.doctorName.includes("External Doctor")) {
        return false;
      }
    }
    return true;
  },
  {
    message: "Valid Doctor Name and Doctor Registration Number are required for Schedule H / Controlled prescriptions",
    path: ["doctorRegNo"],
  },
);

// Header-only edit. patientId and items are deliberately excluded: a
// prescription cannot be re-parented to another patient, and its dispensed
// items must not be silently swapped out from under the dispensing record.
export const updatePrescriptionSchema = basePrescriptionSchema
  .omit({ patientId: true, items: true })
  .partial();

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
  branchId: z.string().uuid().optional(),
  status: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreatePrescriptionDto = z.infer<typeof createPrescriptionSchema>;
export type UpdatePrescriptionDto = z.infer<typeof updatePrescriptionSchema>;
export type VerifyPrescriptionDto = z.infer<typeof verifyPrescriptionSchema>;
export type QueryPrescriptionDto = z.infer<typeof queryPrescriptionSchema>;
