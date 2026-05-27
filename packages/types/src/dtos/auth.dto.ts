import { z } from "zod";
import { UserRole } from "../enums";

const userRoleValues = Object.values(UserRole) as [string, ...string[]];

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  totpCode: z.string().length(6).optional(),
});

export const registerSchema = z.object({
  email: z.string().email(),
  password: z
    .string()
    .min(8)
    .regex(/[A-Z]/, "must contain uppercase")
    .regex(/[0-9]/, "must contain number"),
  firstName: z.string().min(2, "Required"),
  lastName: z.string().min(2, "Required"),
  role: z.string().transform(v => v.toLowerCase()).pipe(z.enum(userRoleValues)).optional(),
  branchId: z.string().uuid().optional(),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string(),
    newPassword: z
      .string()
      .min(8)
      .regex(/[A-Z]/)
      .regex(/[0-9]/),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type LoginDto = z.infer<typeof loginSchema>;
export type RegisterDto = z.infer<typeof registerSchema>;
export type RefreshTokenDto = z.infer<typeof refreshTokenSchema>;
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;
