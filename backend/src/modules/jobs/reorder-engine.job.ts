import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { eq, sql } from "drizzle-orm";
import { DrizzleService } from "../../database/drizzle.service";
import * as schema from "../../database/schema";

@Injectable()
export class ReorderEngineJob {
  private readonly logger = new Logger(ReorderEngineJob.name);

  constructor(private readonly drizzle: DrizzleService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron() {
    this.logger.log("Starting hourly reorder engine scan...");

    const db = this.drizzle.db;

    // Get aggregate quantity for each active medicine
    const stockLevels = await db
      .select({
        medicineId: schema.medicines.id,
        name: schema.medicines.name,
        reorderLevel: schema.medicines.reorderLevel,
        reorderQty: schema.medicines.reorderQty,
        totalQuantity: sql<number>`COALESCE(SUM(${schema.inventoryBatches.quantity}), 0)::int`,
      })
      .from(schema.medicines)
      .leftJoin(
        schema.inventoryBatches,
        eq(schema.medicines.id, schema.inventoryBatches.medicineId)
      )
      .where(eq(schema.medicines.isActive, true))
      .groupBy(schema.medicines.id);

    const lowStockItems = stockLevels.filter(item => item.totalQuantity <= item.reorderLevel);

    if (lowStockItems.length > 0) {
      this.logger.warn(`Found ${lowStockItems.length} items below reorder level.`);

      const alertsData = lowStockItems.map(item => ({
        type: "REORDER",
        message: `${item.name} is low on stock (${item.totalQuantity} <= ${item.reorderLevel}). Consider reordering ${item.reorderQty} units.`,
        referenceId: item.medicineId,
      }));

      await db.insert(schema.systemAlerts).values(alertsData);
      this.logger.log("Created reorder alerts successfully.");
    } else {
      this.logger.log("All stock levels are optimal.");
    }
  }
}
