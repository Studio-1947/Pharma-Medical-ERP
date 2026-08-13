import { Process, Processor } from "@nestjs/bull";
import { Logger, Optional } from "@nestjs/common";
import { Job } from "bull";
import { InventoryRepository } from "../inventory.repository";
import { AlertsRepository } from "../alerts.repository";
import { NotificationsService } from "../../notifications/notifications.service";

export const REORDER_CHECK_QUEUE = "reorder-check";

@Processor(REORDER_CHECK_QUEUE)
export class ReorderCheckProcessor {
  private readonly logger = new Logger(ReorderCheckProcessor.name);

  constructor(
    private readonly inventoryRepo: InventoryRepository,
    private readonly alertsRepo: AlertsRepository,
    @Optional() private readonly notificationsService?: NotificationsService,
  ) {}

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

    let raised = 0;

    for (const branch of branches) {
      const rows = await this.inventoryRepo.getLowStockMedicines(branch.id);
      const items: any[] = Array.isArray(rows)
        ? rows
        : (rows as any).data ?? (rows as any).rows ?? [];

      if (items.length > 0) {
        this.logger.log(
          `${branch.name}: ${items.length} medicines below reorder level`,
        );
        raised += await this.alertsRepo.raiseMany(
          items.map((m) => ({
            type: "REORDER" as const,
            referenceId: m.id,
            branchId: branch.id,
            message: `${m.name} is at ${m.current_stock ?? 0} units, at or below its reorder level of ${m.reorder_level ?? 0}.`,
          })),
        );

        if (this.notificationsService) {
          for (const m of items) {
            await this.notificationsService.create({
              type: "low_stock",
              title: `Low Stock Alert: ${m.name}`,
              message: `${m.name} stock is at ${m.current_stock ?? 0} units (Reorder level: ${m.reorder_level ?? 0}).`,
              resourceType: "medicine",
              resourceId: m.id,
            });
          }
        }
      }

      perBranch.push({ branchId: branch.id, branchName: branch.name, medicines: items });
    }

    const total = perBranch.reduce((sum, b) => sum + b.medicines.length, 0);
    this.logger.log(
      `Reorder check complete — ${total} low-stock lines across ${branches.length} branches, ${raised} new alerts raised`,
    );

    return { lowStockCount: total, alertsRaised: raised, branches: perBranch };
  }
}

