import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { AuthRepository } from "../auth.repository";
import type { JwtPayload } from "../../../common/decorators/current-user.decorator";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly repo: AuthRepository,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get("JWT_PUBLIC_KEY")?.replace(/\\n/g, "\n"),
      algorithms: ["RS256"],
    });
  }

  /**
   * Re-reads the user on every request instead of trusting the token body.
   *
   * A signed JWT is only a snapshot of who the user was when it was issued, and
   * these live for hours. Without this lookup, deactivating an account, demoting
   * a role or resetting a compromised password all leave the old token fully
   * usable until it expires, carrying whatever privileges `role` held at sign-in.
   *
   * Costs one indexed primary-key read per authenticated request. If that ever
   * shows up in profiling, cache it in Redis with a short TTL rather than
   * dropping the check.
   */
  async validate(payload: JwtPayload): Promise<JwtPayload> {
    if (!payload.sub) throw new UnauthorizedException();

    const user = await this.repo.findUserById(payload.sub);
    if (!user || !user.isActive) {
      throw new UnauthorizedException("Account is no longer active");
    }

    // Password changes revoke refresh tokens; this is what revokes the access
    // tokens already in the wild, which is the whole point of resetting a
    // password you believe is compromised.
    //
    // `iat` is whole seconds while passwordChangedAt has millisecond precision,
    // so a token minted in the same second as the change floors to just before
    // it. Without the one-second allowance, signing back in immediately after
    // changing your password hands you a token that is rejected on sight.
    if (
      user.passwordChangedAt &&
      payload.iat * 1000 < user.passwordChangedAt.getTime() - 1000
    ) {
      throw new UnauthorizedException("Password changed - please sign in again");
    }

    // Role and branch come from the database, not the token, so a demotion or
    // branch move takes effect on the next request rather than at expiry.
    return {
      ...payload,
      email: user.email,
      role: user.role,
      branchId: user.branchId ?? undefined,
    };
  }
}
