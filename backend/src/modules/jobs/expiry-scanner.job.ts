import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { InjectQueue } from "@nestjs/bull";
import { Queue } from "bull";
import { EXPIRY_SCAN_QUEUE } from "../inventory/jobs/expiry-scan.processor";

@Injectable()
export class ExpiryScannerJob {
  private readonly logger = new Logger(ExpiryScannerJob.name);

  constructor(@InjectQueue(EXPIRY_SCAN_QUEUE) private readonly queue: Queue) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleCron() {
    this.logger.log("Enqueuing nightly expiry scan...");
    await this.queue.add("scan", {}, { attempts: 3, backoff: { type: "exponential", delay: 60_000 } });
  }
}
