import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { InjectQueue } from "@nestjs/bull";
import { Queue } from "bull";
import { REORDER_CHECK_QUEUE } from "../inventory/jobs/reorder-check.processor";

@Injectable()
export class ReorderEngineJob {
  private readonly logger = new Logger(ReorderEngineJob.name);

  constructor(@InjectQueue(REORDER_CHECK_QUEUE) private readonly queue: Queue) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron() {
    this.logger.log("Enqueuing hourly reorder check...");
    await this.queue.add("check", {}, { attempts: 3, backoff: { type: "exponential", delay: 30_000 } });
  }
}
