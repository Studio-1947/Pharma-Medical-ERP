import { createParamDecorator, ExecutionContext } from "@nestjs/common";

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  branchId?: string;
  /**
   * Present only on impersonation tokens: the super_admin actually driving the
   * session. Named after the RFC 8693 "actor" claim.
   *
   * `sub` stays the impersonated user so every existing role and branch check
   * keeps working unchanged, and this carries the real actor through for audit
   * attribution, the UI banner, and NoImpersonationGuard.
   *
   * JwtStrategy.validate spreads the payload before overriding role/branchId
   * from the database, so this custom claim survives validation.
   */
  act?: ImpersonationActor;
  iat: number;
  exp: number;
}

export interface ImpersonationActor {
  /** users.id of the super_admin who started the impersonation. */
  sub: string;
  email: string;
  /** Correlates the START and STOP audit rows for one impersonation. */
  sid: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as JwtPayload;
  },
);
