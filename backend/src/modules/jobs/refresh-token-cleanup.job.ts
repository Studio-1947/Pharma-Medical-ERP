import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { AuthRepository } from "../auth/auth.repository";

/**
 * Prunes refresh tokens that are past their expiry.
 *
 * The table gains a row on every login and every rotation and nothing ever
 * removed them, so it grew without bound on the busiest write path in the
 * system. Expired rows can no longer authenticate anyone — findValidRefreshToken
 * filters on expiresAt — so deleting them loses nothing. Revoked-but-unexpired
 * rows are deliberately kept: they are what reuse detection matches against.
 */
@Injectable()
export class RefreshTokenCleanupJob {
  private readonly logger = new Logger(RefreshTokenCleanupJob.name);

  constructor(private readonly authRepo: AuthRepository) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleCron() {
    try {
      const removed = await this.authRepo.deleteExpiredRefreshTokens();
      if (removed > 0) {
        this.logger.log(`Pruned ${removed} expired refresh tokens`);
      }
    } catch (err) {
      this.logger.error("Failed to prune expired refresh tokens", err as Error);
    }
  }
}
