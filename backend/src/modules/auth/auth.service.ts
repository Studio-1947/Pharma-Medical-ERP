import {
  Injectable,
  ConflictException,
  UnauthorizedException,
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
  constructor(
    private readonly repo: AuthRepository,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    console.time("register:total");
    
    console.time("register:findUser");
    const existing = await this.repo.findUserByEmail(dto.email);
    console.timeEnd("register:findUser");
    
    if (existing) throw new ConflictException("Email already registered");

    console.time("register:hashPassword");
    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
      timeCost: 2,
      memoryCost: 65536,
      parallelism: 1,
    });
    console.timeEnd("register:hashPassword");

    console.time("register:createUser");
    const user = await this.repo.createUser({
      email: dto.email,
      passwordHash,
      firstName: dto.firstName,
      lastName: dto.lastName,
      role: dto.role,
      branchId: dto.branchId,
    });
    console.timeEnd("register:createUser");

    console.timeEnd("register:total");
    return { user };
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
    if (!stored) throw new UnauthorizedException("Invalid or expired token");

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
