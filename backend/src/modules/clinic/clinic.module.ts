import { Module } from "@nestjs/common";
import { ClinicController } from "./clinic.controller";
import { ClinicService } from "./clinic.service";
import { ClinicRepository } from "./clinic.repository";

@Module({
  controllers: [ClinicController],
  providers: [ClinicService, ClinicRepository],
  exports: [ClinicRepository],
})
export class ClinicModule {}
