import { Module } from "@nestjs/common";
import { SharingController } from "./sharing.controller";
import { PublicRecordsController } from "./public-records.controller";
import { SharingService } from "./sharing.service";

@Module({
  controllers: [SharingController, PublicRecordsController],
  providers: [SharingService],
  exports: [SharingService],
})
export class SharingModule {}
