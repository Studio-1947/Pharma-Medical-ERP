import { z } from "zod";
import { booleanFlag } from "./query-flags";

export const createPatientSchema = z.object({
  name: z.string().min(1, "Patient name is required").max(255),
  phone: z
    .string()
    .min(10, "Phone number must be at least 10 digits")
    .max(20, "Phone number is too long")
    .regex(/^[+]?[0-9\s\-()]{10,20}$/, "Invalid phone number format. Please enter a valid 10-digit mobile number."),
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
  // Narrows to patients carrying an unpaid balance and orders by the largest
  // debt first — the collection worklist, rather than an alphabetical roster.
  hasDues: booleanFlag.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreatePatientDto = z.infer<typeof createPatientSchema>;
export type UpdatePatientDto = z.infer<typeof updatePatientSchema>;
export type QueryPatientDto = z.infer<typeof queryPatientSchema>;
