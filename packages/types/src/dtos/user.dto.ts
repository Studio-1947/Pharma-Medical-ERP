import { z } from "zod";
import { UserRole } from "../enums";

export const doctorProfileSchema = z.object({
  specialty: z.string().optional(),
  opdRoom: z.string().optional(),
  consultationFee: z.union([z.number(), z.string()]).optional(),
  regNo: z.string().optional(),
  phone: z.string().optional(),
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
