import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import type { JwtPayload } from "../decorators/current-user.decorator";

/**
 * Refuses any request carrying an impersonation token.
 *
 * Defence in depth for a specific laundering path: RolesGuard passes
 * super_admin unconditionally, so if an impersonation session ever reached a
 * privileged endpoint the action would be performed under the impersonated
 * identity while carrying the operator's authority — attributable to neither
 * cleanly. Impersonation exists to reproduce what a user sees, not to act as
 * an administrator through them, so administrative routes reject it outright.
 *
 * Applied per-method on the admin routes rather than class-level, because
 * POST /admin/impersonate/stop is by definition called while impersonating.
 */
@Injectable()
export class NoImpersonationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest<{ user?: JwtPayload }>();

    if (user?.act) {
      throw new ForbiddenException(
        "This action is not available while impersonating another user. Stop impersonating first.",
      );
    }

    return true;
  }
}
