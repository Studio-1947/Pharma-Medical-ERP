import { Process, Processor } from "@nestjs/bull";
import { Logger } from "@nestjs/common";
import { Job } from "bull";
import { BatchRepository } from "../batch.repository";
import { StockMovementRepository } from "../stock-movement.repository";

export const EXPIRY_SCAN_QUEUE = "expiry-scan";

@Processor(EXPIRY_SCAN_QUEUE)
export class ExpiryScanProcessor {
  private readonly logger = new Logger(ExpiryScanProcessor.name);

  constructor(
    private readonly batchRepo: BatchRepository,
    private readonly movementRepo: StockMovementRepository,
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
          movementType: "expiry_write_off",
          quantity: -full.quantity,
          notes: "Auto write-off on expiry scan",
        });
        await this.batchRepo.adjustQuantity(b.id, -full.quantity);
      }
    }

    // 3. Collect critical (<30 days) and warning (30-90 days) for notifications
    const critical = await this.batchRepo.findExpiringBatches(30);
    const warning = await this.batchRepo.findExpiringBatches(90);

    this.logger.log(
      `Expiry alerts: ${critical.length} critical, ${warning.length - critical.length} warning`,
    );

    return {
      expiredCount: expired.length,
      criticalCount: critical.length,
      warningCount: warning.length,
    };
  }
}
