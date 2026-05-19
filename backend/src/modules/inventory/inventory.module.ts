import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bull";
import { InventoryController } from "./inventory.controller";
import { InventoryService } from "./inventory.service";
import { InventoryRepository } from "./inventory.repository";
import { BatchController } from "./batch.controller";
import { BatchService } from "./batch.service";
import { BatchRepository } from "./batch.repository";
import { StockMovementRepository } from "./stock-movement.repository";
import { WarehouseController } from "./warehouse.controller";
import { WarehouseRepository } from "./warehouse.repository";
import { BarcodeService } from "./barcode.service";
import { AlertsController } from "./alerts.controller";
import { ExpiryScanProcessor, EXPIRY_SCAN_QUEUE } from "./jobs/expiry-scan.processor";
import { ReorderCheckProcessor, REORDER_CHECK_QUEUE } from "./jobs/reorder-check.processor";

@Module({
  imports: [
    BullModule.registerQueue(
      { name: EXPIRY_SCAN_QUEUE },
      { name: REORDER_CHECK_QUEUE },
    ),
  ],
  controllers: [InventoryController, BatchController, WarehouseController, AlertsController],
  providers: [
    InventoryService,
    InventoryRepository,
    BatchService,
    BatchRepository,
    StockMovementRepository,
    WarehouseRepository,
    BarcodeService,
    ExpiryScanProcessor,
    ReorderCheckProcessor,
  ],
  exports: [InventoryService, BatchService, StockMovementRepository],
})
export class InventoryModule {}
