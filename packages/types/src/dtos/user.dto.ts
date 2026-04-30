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

export const updateUserSchema = z.object({
  firstName: z.string().min(2).optional(),
  lastName: z.string().min(2).optional(),
  role: z.string().optional(),
  branchId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});

export type UserDto = z.infer<typeof userSchema>;
export type UpdateUserDto = z.infer<typeof updateUserSchema>;
