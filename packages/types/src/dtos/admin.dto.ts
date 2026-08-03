import { z } from "zod";
import { UserRole } from "../enums";

/**
 * DTOs for the super_admin developer console.
 *
 * These deliberately allow things the ordinary user endpoints refuse — most
 * notably minting another super_admin. The privilege check is not in the shape
 * of the request but in common/auth/role-hierarchy.ts, which every write path
 * calls with the authenticated caller.
 */

/** Shared password rule, matching registerSchema in auth.dto.ts. */
const strongPassword = z
  .string()
  .min(8, "Must be at least 8 characters")
  .regex(/[A-Z]/, "must contain uppercase")
  .regex(/[0-9]/, "must contain number");

/** Accepts the uppercase keys the UI posts and narrows to the enum value. */
const roleField = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.nativeEnum(UserRole));

export const adminCreateUserSchema = z.object({
  email: z.string().email(),
  password: strongPassword,
  firstName: z.string().min(2, "Required"),
  lastName: z.string().min(2, "Required"),
  role: roleField,
  // Nullable rather than merely optional: a super_admin is the one account
  // that legitimately has no branch, and null is how that is expressed.
  branchId: z.string().uuid().nullable().optional(),
});

export const adminUpdateUserSchema = z.object({
  email: z.string().email().optional(),
  firstName: z.string().min(2).optional(),
  lastName: z.string().min(2).optional(),
  role: roleField.optional(),
  branchId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const adminSetPasswordSchema = z.object({
  newPassword: strongPassword,
  /** Ends every open session for the target. Defaults on: resetting a password
   *  you believe is compromised is pointless if existing sessions survive. */
  revokeSessions: z.boolean().optional().default(true),
});

export const impersonateSchema = z.object({
  /** Minutes the impersonation token stays valid. Capped server-side. */
  durationMinutes: z.coerce.number().int().min(1).max(60).optional().default(15),
  reason: z.string().max(500).optional(),
});

export const auditLogQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  action: z.string().max(100).optional(),
  entity: z.string().max(100).optional(),
  entityId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

export const adminUserQuerySchema = z.object({
  search: z.string().optional(),
  role: roleField.optional(),
  branchId: z.string().uuid().optional(),
  isActive: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => (typeof v === "string" ? v === "true" : v))
    .optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(200).optional().default(25),
});

export const sessionQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  /** Include revoked and expired rows, not just live sessions. */
  includeInactive: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => (typeof v === "string" ? v === "true" : v))
    .optional()
    .default(false),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

export type AdminCreateUserDto = z.infer<typeof adminCreateUserSchema>;
export type AdminUpdateUserDto = z.infer<typeof adminUpdateUserSchema>;
export type AdminSetPasswordDto = z.infer<typeof adminSetPasswordSchema>;
export type ImpersonateDto = z.infer<typeof impersonateSchema>;
export type AuditLogQueryDto = z.infer<typeof auditLogQuerySchema>;
export type AdminUserQueryDto = z.infer<typeof adminUserQuerySchema>;
export type SessionQueryDto = z.infer<typeof sessionQuerySchema>;
