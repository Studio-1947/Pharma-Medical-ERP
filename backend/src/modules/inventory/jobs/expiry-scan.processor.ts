import { Process, Processor } from "@nestjs/bull";
import { Logger, Optional } from "@nestjs/common";
import { Job } from "bull";
import { BatchRepository } from "../batch.repository";
import { StockMovementRepository } from "../stock-movement.repository";
import { AlertsRepository } from "../alerts.repository";
import { NotificationsService } from "../../notifications/notifications.service";

export const EXPIRY_SCAN_QUEUE = "expiry-scan";

@Processor(EXPIRY_SCAN_QUEUE)
export class ExpiryScanProcessor {
  private readonly logger = new Logger(ExpiryScanProcessor.name);

  constructor(
    private readonly batchRepo: BatchRepository,
    private readonly movementRepo: StockMovementRepository,
    private readonly alertsRepo: AlertsRepository,
    @Optional() private readonly notificationsService?: NotificationsService,
  ) {}

  /**
   * Nightly job: marks actually-expired batches + collects batches
   * expiring within 30 and 90 days for alert payloads.
   */
  @Process("scan")
  async handleScan(job: Job) {
    this.logger.log("Starting expiry scan...");

    // 1. Hard-expire any batches past their date
    const expired = await this.batchRepo.markExpiredBatches();
    this.logger.log(`Marked ${expired.length} batches as expired`);

    // 2. Write-off stock for newly expired batches
    for (const b of expired) {
      const full = await this.batchRepo.findBatchById(b.id);
      if (full && full.quantity > 0) {
        await this.movementRepo.log({
          batchId: b.id,
          medicineId: full.medicineId,
          branchId: full.branchId,
          movementType: "expiry_write_off",
          quantity: -full.quantity,
          notes: "Auto write-off on expiry scan",
        });
        await this.batchRepo.adjustQuantity(b.id, -full.quantity);
      }
    }

    // 3. Raise expiry alerts, addressed to the branch holding the stock.
    //    These lists were previously collected, counted into a log line and
    //    discarded, so nothing ever reached the /alerts screen.
    const critical = await this.batchRepo.findExpiringBatches(30);
    const warning = await this.batchRepo.findExpiringBatches(90);

    const criticalIds = new Set(critical.map((b) => b.id));
    const raised = await this.alertsRepo.raiseMany([
      ...critical.map((b) => ({
        type: "EXPIRY" as const,
        // The batch, not the medicine: two batches of the same drug expire on
        // different dates and each needs its own action.
        referenceId: b.id,
        branchId: b.branchId,
        message: `Batch ${b.batchNo} expires on ${b.expiryDate} (${b.quantity} units) — within 30 days.`,
      })),
      ...warning
        .filter((b) => !criticalIds.has(b.id))
        .map((b) => ({
          type: "EXPIRY" as const,
          referenceId: b.id,
          branchId: b.branchId,
          message: `Batch ${b.batchNo} expires on ${b.expiryDate} (${b.quantity} units) — within 90 days.`,
        })),
    ]);

    // Create user notifications for expired batches
    if (this.notificationsService) {
      for (const b of expired) {
        const full = await this.batchRepo.findBatchById(b.id);
        if (full) {
          await this.notificationsService.create({
            type: "expired",
            title: "Batch Expired & Written Off",
            message: `Batch ${full.batchNo} has expired (${full.quantity} units auto written-off).`,
            resourceType: "batch",
            resourceId: full.id,
          });
        }
      }

      for (const b of critical) {
        await this.notificationsService.create({
          type: "near_expiry",
          title: "Batch Expiry Warning (< 30 Days)",
          message: `Batch ${b.batchNo} expires on ${b.expiryDate} (${b.quantity} units remaining).`,
          resourceType: "batch",
          resourceId: b.id,
        });
      }
    }

    this.logger.log(
      `Expiry: ${critical.length} critical, ${warning.length - critical.length} warning, ${raised} new alerts raised`,
    );

    return {
      expiredCount: expired.length,
      criticalCount: critical.length,
      warningCount: warning.length,
      alertsRaised: raised,
    };
  }
}
