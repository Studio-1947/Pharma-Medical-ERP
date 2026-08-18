import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ROLES_KEY } from "../decorators/roles.decorator";
import type { JwtPayload } from "../decorators/current-user.decorator";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest<{ user: JwtPayload }>();
    if (!user) return false;

    // super_admin bypasses all role checks
    if (user.role === "super_admin") return true;

    if (!required.includes(user.role)) {
      throw new ForbiddenException(
        "You do not have permission to do this. Ask an administrator if you need access.",
      );
    }
    return true;
  }
}
