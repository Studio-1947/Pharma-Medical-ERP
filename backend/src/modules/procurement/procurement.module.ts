import { Module } from "@nestjs/common";
import { ProcurementController } from "./procurement.controller";
import { ProcurementService } from "./procurement.service";
import { ProcurementRepository } from "./procurement.repository";
import { StockMovementRepository } from "../inventory/stock-movement.repository";

@Module({
  controllers: [ProcurementController],
  providers: [ProcurementService, ProcurementRepository, StockMovementRepository],
  exports: [ProcurementRepository],
})
export class ProcurementModule {}
