import { Module } from "@nestjs/common";
import { DistributionController } from "./distribution.controller";
import { DistributionService } from "./distribution.service";
import { DistributionRepository } from "./distribution.repository";

@Module({
  controllers: [DistributionController],
  providers: [DistributionService, DistributionRepository],
  exports: [DistributionRepository],
})
export class DistributionModule {}
