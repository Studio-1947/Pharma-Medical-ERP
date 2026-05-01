import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bull";
import { ScheduleModule } from "@nestjs/schedule";
import { ExpiryScannerJob } from "./expiry-scanner.job";
import { ReorderEngineJob } from "./reorder-engine.job";
import { InvoicePdfWorker } from "./invoice-pdf.worker";

@Module({
  imports: [
    ScheduleModule.forRoot(),
    BullModule.registerQueue({
      name: "pdf-generation",
    }),
  ],
  providers: [ExpiryScannerJob, ReorderEngineJob, InvoicePdfWorker],
})
export class JobsModule {}
