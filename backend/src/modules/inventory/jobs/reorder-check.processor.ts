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
   * Nightly job: finds medicines at or below reorder level, per branch.
   *
   * Runs branch by branch because reordering is a branch decision. A single
   * company-wide sum hides the case this job exists to catch: one branch out of
   * a drug while another is overstocked nets out above the reorder level, so
   * the branch that actually needs stock is never flagged.
   */
  @Process("check")
  async handleCheck(_job: Job) {
    this.logger.log("Running reorder level check...");

    const branches = await this.inventoryRepo.findActiveBranches();
    const perBranch: { branchId: string; branchName: string; medicines: unknown[] }[] = [];

    for (const branch of branches) {
      const rows = await this.inventoryRepo.getLowStockMedicines(branch.id);
      const items = Array.isArray(rows) ? rows : (rows as any).data ?? (rows as any).rows ?? [];
      if (items.length > 0) {
        this.logger.log(
          `${branch.name}: ${items.length} medicines below reorder level`,
        );
      }
      perBranch.push({ branchId: branch.id, branchName: branch.name, medicines: items });
    }

    const total = perBranch.reduce((sum, b) => sum + b.medicines.length, 0);
    this.logger.log(`Reorder check complete — ${total} low-stock lines across ${branches.length} branches`);

    // TODO (Phase 3 / procurement): auto-generate draft POs per branch for each
    //   low-stock medicine that has a preferred supplier configured.

    return { lowStockCount: total, branches: perBranch };
  }
}
