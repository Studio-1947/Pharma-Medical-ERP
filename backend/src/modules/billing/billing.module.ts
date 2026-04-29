import { Module } from "@nestjs/common";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";
import { BillingRepository } from "./billing.repository";
import { TaxService } from "./tax.service";
import { BatchRepository } from "../inventory/batch.repository";
import { StockMovementRepository } from "../inventory/stock-movement.repository";
import { RedisModule } from "../../common/redis/redis.module";

@Module({
  imports: [RedisModule],
  controllers: [BillingController],
  providers: [
    BillingService,
    BillingRepository,
    TaxService,
    BatchRepository,
    StockMovementRepository,
  ],
  exports: [BillingService],
})
export class BillingModule {}
