import { Process, Processor } from "@nestjs/bull";
import { Logger } from "@nestjs/common";
import { Job } from "bull";
import { InventoryRepository } from "../inventory.repository";

export const REORDER_CHECK_QUEUE = "reorder-check";

@Processor(REORDER_CHECK_QUEUE)
export class ReorderCheckProcessor {
  private readonly logger = new Logger(ReorderCheckProcessor.name);

  constructor(private readonly inventoryRepo: InventoryRepository) {}

  /**
   * Nightly job: finds all medicines at or below reorder level.
   * In a full implementation this would create draft POs and emit WS events.
   */
  @Process("check")
  async handleCheck(_job: Job) {
    this.logger.log("Running reorder level check...");

    const rows = await this.inventoryRepo.getLowStockMedicines();
    const items = Array.isArray(rows) ? rows : (rows as any).rows ?? [];

    this.logger.log(`Found ${items.length} medicines below reorder level`);

    // TODO (Phase 3 / procurement): auto-generate draft POs for each low-stock
    //   medicine that has a preferred supplier configured.

    return { lowStockCount: items.length, medicines: items };
  }
}
