import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bull";
import { ScheduleModule } from "@nestjs/schedule";
import { ExpiryScannerJob } from "./expiry-scanner.job";
import { ReorderEngineJob } from "./reorder-engine.job";
import { InvoicePdfWorker } from "./invoice-pdf.worker";
import { RefreshTokenCleanupJob } from "./refresh-token-cleanup.job";
import { AuthModule } from "../auth/auth.module";
import { EXPIRY_SCAN_QUEUE } from "../inventory/jobs/expiry-scan.processor";
import { REORDER_CHECK_QUEUE } from "../inventory/jobs/reorder-check.processor";

@Module({
  imports: [
    AuthModule,
    ScheduleModule.forRoot(),
    BullModule.registerQueue(
      { name: "pdf-generation" },
      { name: EXPIRY_SCAN_QUEUE },
      { name: REORDER_CHECK_QUEUE },
    ),
  ],
  providers: [ExpiryScannerJob, ReorderEngineJob, InvoicePdfWorker, RefreshTokenCleanupJob],
})
export class JobsModule {}
