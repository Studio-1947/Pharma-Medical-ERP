import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import * as argon2 from "argon2";
import { createHash, randomBytes } from "crypto";
import { AuthRepository } from "./auth.repository";
import type { LoginDto, RegisterDto } from "@pharmerp/types";
import type { JwtPayload } from "../../common/decorators/current-user.decorator";

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly repo: AuthRepository,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto, caller: JwtPayload) {
    // super_admin can create any role except another super_admin
    // admin can only create branch-level roles (not super_admin or admin)
    const requestedRole = dto.role ?? "shop_manager";
    // Every non-privileged role a branch admin may onboard. `doctor` belongs
    // here: it is a branch-level clinical role, and leaving it out meant only
    // super_admin could staff a branch's own clinic.
    const adminOnlyRoles = ["shop_manager", "doctor"];

    if (caller.role === "admin" && !adminOnlyRoles.includes(requestedRole)) {
      throw new ForbiddenException("Admins can only create branch-level staff accounts");
    }
    // Deliberately still closed here. This endpoint is branch onboarding and is
    // callable by `admin`; POST /users/invite is the single audited path that
    // may mint a super_admin, and it checks caller authority via
    // common/auth/role-hierarchy.ts rather than a blanket refusal.
    if (requestedRole === "super_admin") {
      throw new ForbiddenException(
        "super_admin accounts are created from the admin console (POST /users/invite), not this endpoint",
      );
    }

    let targetBranchId = dto.branchId;
    if (caller.role === "admin") {
      if (!caller.branchId) {
        throw new ForbiddenException("Admin account is not assigned to a branch");
      }
      if (dto.branchId && dto.branchId !== caller.branchId) {
        throw new ForbiddenException("Admins can only create users within their own branch");
      }
      targetBranchId = caller.branchId;
    }

    const existing = await this.repo.findUserByEmail(dto.email);
    if (existing) throw new ConflictException("Email already registered");

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
      timeCost: 2,
      memoryCost: 65536,
      parallelism: 1,
    });

    const user = await this.repo.createUser({
      email: dto.email,
      passwordHash,
      firstName: dto.firstName,
      lastName: dto.lastName,
      role: requestedRole,
      branchId: targetBranchId,
      doctorProfile: (dto as any).doctorProfile,
    });

    this.logger.log(`User ${caller.email} created account for: ${user!.email} (${requestedRole})`);
    return { user: user! };
  }

  async login(
    dto: LoginDto,
    meta: { ip?: string; userAgent?: string } = {},
  ) {
    const user = await this.repo.findUserByEmail(dto.email);
    if (!user || !user.isActive) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const valid = await argon2.verify(user.passwordHash, dto.password);
    if (!valid) throw new UnauthorizedException("Invalid credentials");

    await this.repo.updateLastLogin(user.id);
    return this.issueTokens(user, meta);
  }

  async refresh(
    rawToken: string,
    meta: { ip?: string; userAgent?: string } = {},
  ) {
    const hash = this.hashToken(rawToken);
    const stored = await this.repo.findValidRefreshToken(hash);
    if (!stored) {
      await this.handleRefreshTokenReuse(hash);
      throw new UnauthorizedException("Invalid or expired token");
    }

    const user = await this.repo.findUserById(stored.userId);
    if (!user || !user.isActive) throw new UnauthorizedException();

    // Rotate: revoke old, issue new
    await this.repo.revokeRefreshToken(stored.id);
    return this.issueTokens(user, meta);
  }

  async logout(userId: string) {
    await this.repo.revokeAllUserTokens(userId);
    return { message: "Logged out successfully" };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.repo.findUserById(userId);
    if (!user) throw new UnauthorizedException("User not found");

    const valid = await argon2.verify(user.passwordHash, currentPassword);
    if (!valid) throw new UnauthorizedException("Current password is incorrect");

    const newHash = await argon2.hash(newPassword, {
      type: argon2.argon2id,
      timeCost: 2,
      memoryCost: 65536,
      parallelism: 1,
    });

    await this.repo.updatePasswordHash(userId, newHash);
    await this.repo.revokeAllUserTokens(userId);
    return { message: "Password changed successfully. Please log in again." };
  }

  // -----------------------------------------------------------------------

  private async issueTokens(
    user: { id: string; email: string; role: string; branchId?: string | null },
    meta: { ip?: string; userAgent?: string },
  ) {
    const payload: Omit<JwtPayload, "iat" | "exp"> = {
      sub: user.id,
      email: user.email,
      role: user.role,
      branchId: user.branchId ?? undefined,
    };

    const accessToken = this.jwt.sign(payload);

    const rawRefresh = randomBytes(64).toString("hex");
    const expiresIn = this.config.get("REFRESH_TOKEN_EXPIRES_IN") ?? "7d";
    const expiresAt = new Date(
      Date.now() + this.parseDuration(expiresIn),
    );

    await this.repo.saveRefreshToken({
      userId: user.id,
      tokenHash: this.hashToken(rawRefresh),
      expiresAt,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return {
      accessToken,
      refreshToken: rawRefresh,
      expiresAt,
    };
  }

  /**
   * Refresh tokens are single-use: presenting one that has already been rotated
   * away means either a stale client retry or a stolen token being replayed.
   * The two are indistinguishable, so the safe reading is theft — the entire
   * token family is revoked, which logs out both the attacker and the real
   * user, who then re-authenticates with their password.
   */
  private async handleRefreshTokenReuse(hash: string) {
    const reused = await this.repo.findRefreshTokenByHash(hash);
    if (!reused) return;

    await this.repo.revokeAllUserTokens(reused.userId);
    this.logger.warn(
      `Refresh token reuse detected for user ${reused.userId} - revoked all sessions`,
    );
  }

  private hashToken(raw: string): string {
    return createHash("sha256").update(raw).digest("hex");
  }

  /** Convert "7d" / "15m" to milliseconds */
  private parseDuration(s: string): number {
    const units: Record<string, number> = {
      s: 1000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    const match = s.match(/^(\d+)([smhd])$/);
    if (!match) return 7 * 86_400_000;
    return parseInt(match[1]!) * (units[match[2]!] ?? 86_400_000);
  }
}
