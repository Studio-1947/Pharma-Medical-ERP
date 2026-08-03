import { z } from "zod";
import { UserRole } from "../enums";

export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  role: z.nativeEnum(UserRole),
  branchId: z.string().uuid().nullable(),
  isActive: z.boolean(),
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
});

export type UserDto = z.infer<typeof userSchema>;
export type UpdateUserDto = z.infer<typeof updateUserSchema>;
