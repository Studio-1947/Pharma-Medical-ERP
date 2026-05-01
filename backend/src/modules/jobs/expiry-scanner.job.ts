import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { and, eq, lte, gt } from "drizzle-orm";
import { DrizzleService } from "../../database/drizzle.service";
import * as schema from "../../database/schema";

@Injectable()
export class ExpiryScannerJob {
  private readonly logger = new Logger(ExpiryScannerJob.name);

  constructor(private readonly drizzle: DrizzleService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleCron() {
    this.logger.log("Starting daily expiry scan...");

    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + 30); // 30 days from today

    const db = this.drizzle.db;

    const expiringBatches = await db
      .select({
        id: schema.inventoryBatches.id,
        batchNo: schema.inventoryBatches.batchNo,
        medicineName: schema.medicines.name,
        expiryDate: schema.inventoryBatches.expiryDate,
      })
      .from(schema.inventoryBatches)
      .innerJoin(schema.medicines, eq(schema.inventoryBatches.medicineId, schema.medicines.id))
      .where(
        and(
          lte(schema.inventoryBatches.expiryDate, targetDate.toISOString().split("T")[0]!),
          gt(schema.inventoryBatches.quantity, 0),
          eq(schema.inventoryBatches.status, "active")
        )
      );

    if (expiringBatches.length > 0) {
      this.logger.warn(`Found ${expiringBatches.length} batches expiring within 30 days.`);

      const alertsData = expiringBatches.map(batch => ({
        type: "EXPIRY",
        message: `Batch ${batch.batchNo} for ${batch.medicineName} is expiring on ${batch.expiryDate}`,
        referenceId: batch.id,
      }));

      await db.insert(schema.systemAlerts).values(alertsData);
      
      this.logger.log("Created expiry alerts successfully.");
    } else {
      this.logger.log("No near-expiry batches found.");
    }
  }
}
