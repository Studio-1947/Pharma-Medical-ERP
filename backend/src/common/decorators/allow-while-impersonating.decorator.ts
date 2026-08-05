import { SetMetadata } from "@nestjs/common";

export const ALLOW_WHILE_IMPERSONATING = "allowWhileImpersonating";

/**
 * Exempts a mutating route from the read-only impersonation rule.
 *
 * Should stay vanishingly rare — the only legitimate case is ending the
 * impersonation itself, which has to be callable from inside the session it
 * is closing. Anything else marked with this is a hole in the guarantee that
 * no business record can be written under a borrowed identity.
 */
export const AllowWhileImpersonating = () =>
  SetMetadata(ALLOW_WHILE_IMPERSONATING, true);
