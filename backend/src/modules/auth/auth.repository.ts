import { Injectable } from "@nestjs/common";
import { eq, and, isNull, gt, lt } from "drizzle-orm";
import { DrizzleService } from "../../database/drizzle.service";
import * as schema from "../../database/schema";

@Injectable()
export class AuthRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
  }

  async findUserByEmail(email: string) {
    return this.db.query.users.findFirst({
      where: eq(schema.users.email, email),
    });
  }

  async findUserById(id: string) {
    return this.db.query.users.findFirst({
      where: eq(schema.users.id, id),
    });
  }

  async createUser(data: {
    email: string;
    passwordHash: string;
    firstName: string;
    lastName: string;
    role?: string;
    branchId?: string;
    doctorProfile?: Record<string, any>;
  }) {
    const [user] = await this.db
      .insert(schema.users)
      .values({
        email: data.email,
        passwordHash: data.passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        role: (data.role as any) ?? "shop_manager",
        branchId: data.branchId,
        doctorProfile: data.doctorProfile,
      })
      .returning({
        id: schema.users.id,
        email: schema.users.email,
        role: schema.users.role,
        branchId: schema.users.branchId,
        isActive: schema.users.isActive,
        createdAt: schema.users.createdAt,
      });
    return user;
  }

  async saveRefreshToken(data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    ipAddress?: string;
    userAgent?: string;
  }) {
    await this.db.insert(schema.refreshTokens).values({
      userId: data.userId,
      tokenHash: data.tokenHash,
      expiresAt: data.expiresAt,
      ipAddress: data.ipAddress as any,
      userAgent: data.userAgent,
    });
  }

  async findValidRefreshToken(tokenHash: string) {
    return this.db.query.refreshTokens.findFirst({
      where: and(
        eq(schema.refreshTokens.tokenHash, tokenHash),
        isNull(schema.refreshTokens.revokedAt),
        gt(schema.refreshTokens.expiresAt, new Date()),
      ),
    });
  }

  /** Any token matching the hash, revoked or expired — used to detect reuse. */
  async findRefreshTokenByHash(tokenHash: string) {
    return this.db.query.refreshTokens.findFirst({
      where: eq(schema.refreshTokens.tokenHash, tokenHash),
    });
  }

  /** Drops rows that can no longer authenticate anyone. */
  async deleteExpiredRefreshTokens(now: Date = new Date()) {
    const deleted = await this.db
      .delete(schema.refreshTokens)
      .where(lt(schema.refreshTokens.expiresAt, now))
      .returning({ id: schema.refreshTokens.id });
    return deleted.length;
  }

  async revokeRefreshToken(id: string) {
    await this.db
      .update(schema.refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(schema.refreshTokens.id, id));
  }

  async revokeAllUserTokens(userId: string) {
    await this.db
      .update(schema.refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.refreshTokens.userId, userId),
          isNull(schema.refreshTokens.revokedAt),
        ),
      );
  }

  async updateLastLogin(userId: string) {
    await this.db
      .update(schema.users)
      .set({ lastLoginAt: new Date() })
      .where(eq(schema.users.id, userId));
  }

  async updatePasswordHash(userId: string, passwordHash: string) {
    await this.db
      .update(schema.users)
      .set({ passwordHash, passwordChangedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.users.id, userId));
  }
}
