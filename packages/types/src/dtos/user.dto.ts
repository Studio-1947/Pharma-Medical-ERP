import { z } from "zod";
import { UserRole } from "../enums";

export const doctorProfileSchema = z.object({
  specialty: z.string().optional(),
  opdRoom: z.string().optional(),
  consultationFee: z.union([z.number(), z.string()]).optional(),
  regNo: z.string().optional(),
  phone: z.string().optional(),
  /** Credential line printed immediately below the doctor's name on prescriptions. */
  prescriptionCredentials: z.string().max(300).optional(),
  /** Professional designation/appointment line printed on prescriptions. */
  prescriptionDescription: z.string().max(500).optional(),
  /** Concise services shown as the personalised prescription tags. */
  prescriptionTags: z.array(z.string().min(1).max(80)).max(9).optional(),
  /** A short, patient-friendly introduction to the doctor's practice. */
  bio: z.string().max(2_000).optional(),
  /** Degrees, fellowships, and the institutions where they were completed. */
  qualifications: z.array(z.object({
    qualification: z.string().max(200),
    institution: z.string().max(300),
    year: z.string().max(20).optional(),
  })).max(20).optional(),
  /** Previous and current professional appointments. */
  experience: z.array(z.object({
    role: z.string().max(200),
    organization: z.string().max(300),
    period: z.string().max(100).optional(),
  })).max(20).optional(),
  weeklySchedule: z.array(z.object({
    days: z.string(),
    slots: z.string(),
  })).optional(),
  availabilityStatus: z.enum(["available", "on_call", "on_leave", "busy"]).optional(),
}).optional();

export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  role: z.nativeEnum(UserRole),
  branchId: z.string().uuid().nullable(),
  isActive: z.boolean(),
  doctorProfile: doctorProfileSchema,
  lastLoginAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// `role` was a bare z.string(), which the users repository then wrote straight
// into the enum column with an `as any`. That accepted both junk values (a
// driver-level failure) and "super_admin" (a privilege escalation, since the
// endpoint is open to branch admins). Validate it here; the caller's authority
// to grant the role is a separate check in common/auth/role-hierarchy.ts.
export const updateUserSchema = z.object({
  firstName: z.string().min(2).optional(),
  lastName: z.string().min(2).optional(),
  role: z
    .string()
    .transform((v) => v.trim().toLowerCase())
    .pipe(z.nativeEnum(UserRole))
    .optional(),
  branchId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
  doctorProfile: doctorProfileSchema,
});

export type DoctorProfileDto = z.infer<typeof doctorProfileSchema>;
export type UserDto = z.infer<typeof userSchema>;
export type UpdateUserDto = z.infer<typeof updateUserSchema>;
