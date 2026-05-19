import { Module } from "@nestjs/common";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";
import { BillingRepository } from "./billing.repository";
import { TaxService } from "./tax.service";
import { BullModule } from "@nestjs/bull";
import { BatchRepository } from "../inventory/batch.repository";
import { StockMovementRepository } from "../inventory/stock-movement.repository";
import { PatientsRepository } from "../patients/patients.repository";
import { RedisModule } from "../../common/redis/redis.module";

@Module({
  imports: [
    RedisModule,
    BullModule.registerQueue({
      name: "pdf-generation",
    }),
  ],
  controllers: [BillingController],
  providers: [
    BillingService,
    BillingRepository,
    TaxService,
    BatchRepository,
    StockMovementRepository,
    PatientsRepository,
  ],
  exports: [BillingService],
})
export class BillingModule {}
