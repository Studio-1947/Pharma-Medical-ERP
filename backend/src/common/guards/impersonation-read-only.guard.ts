import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ALLOW_WHILE_IMPERSONATING } from "../decorators/allow-while-impersonating.decorator";
import type { JwtPayload } from "../decorators/current-user.decorator";

/** Methods that cannot change state, so they cannot misattribute anything. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Makes every impersonated session read-only.
 *
 * Business modules take the acting user from the token's `sub`, which during
 * impersonation is the *target*. A sale written while impersonating a cashier
 * is therefore stamped with the cashier's id, and a prescription verified
 * while impersonating a pharmacist records that pharmacist as having signed
 * it off. For Schedule H/H1/X dispensing that attribution is a legal record,
 * and an audit row merely bracketing the session in time is not the same as
 * the record naming the right person.
 *
 * Rewriting every module to distinguish "acting user" from "recorded user"
 * would be a large change with many places to miss. Refusing the writes
 * outright makes the misattribution unrepresentable while leaving the actual
 * purpose of impersonation — seeing exactly what the user sees — untouched.
 *
 * Registered globally rather than per-controller so a route added later is
 * covered by default instead of by remembering.
 */
@Injectable()
export class ImpersonationReadOnlyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      user?: JwtPayload;
      method?: string;
    }>();

    // Not an impersonated session: this guard has no opinion.
    if (!request.user?.act) return true;

    const method = (request.method ?? "GET").toUpperCase();
    if (SAFE_METHODS.has(method)) return true;

    const exempt = this.reflector.getAllAndOverride<boolean>(
      ALLOW_WHILE_IMPERSONATING,
      [context.getHandler(), context.getClass()],
    );
    if (exempt) return true;

    throw new ForbiddenException(
      "Impersonation is read-only. Stop impersonating to make changes.",
    );
  }
}
