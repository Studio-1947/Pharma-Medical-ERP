import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be in YYYY-MM-DD format");

export const createClinicTokenSchema = z.object({
  patientId: z.string().uuid(),
  doctorId: z.string().uuid(),
  date: isoDate,
  timeSlot: z.string().max(50).optional(),
  notes: z.string().optional(),
  // Honoured only for super_admin; every other role is pinned to its own
  // branch server-side regardless of what is sent here.
  branchId: z.string().uuid().optional(),
});

export const updateClinicTokenSchema = z.object({
  status: z.enum(["pending", "called", "completed", "cancelled"]).optional(),
  notes: z.string().optional(),
  prescriptionId: z.string().uuid().optional(),
});

export const queryClinicTokenSchema = z.object({
  date: isoDate.optional(),
  doctorId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  status: z.enum(["pending", "called", "completed", "cancelled"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type CreateClinicTokenDto = z.infer<typeof createClinicTokenSchema>;
export type UpdateClinicTokenDto = z.infer<typeof updateClinicTokenSchema>;
export type QueryClinicTokenDto = z.infer<typeof queryClinicTokenSchema>;
