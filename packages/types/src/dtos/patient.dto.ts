import { z } from "zod";

export const createPatientSchema = z.object({
  name: z.string().min(1).max(255),
  phone: z.string().min(7).max(20),
  email: z.string().email().optional(),
  dateOfBirth: z.coerce.date().optional(),
  gender: z.enum(["male", "female", "other"]).optional(),
  address: z.string().optional(),
  state: z.string().max(100).optional(),
  allergies: z.array(z.string()).optional(),
  bloodGroup: z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]).optional(),
  insuranceId: z.string().max(100).optional(),
  insuranceExpiry: z.coerce.date().optional(),
  notes: z.string().optional(),
});

export const updatePatientSchema = createPatientSchema.partial();

export const queryPatientSchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreatePatientDto = z.infer<typeof createPatientSchema>;
export type UpdatePatientDto = z.infer<typeof updatePatientSchema>;
export type QueryPatientDto = z.infer<typeof queryPatientSchema>;
