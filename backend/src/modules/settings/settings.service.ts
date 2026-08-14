import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DrizzleService } from "../../database/drizzle.service";
import * as schema from "../../database/schema";

/** Which billing experience is active installation-wide. */
export type BillingFlow = "old" | "new";

const BILLING_FLOW_KEY = "billing_flow";

@Injectable()
export class SettingsService {
  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
  }

  /** Current billing flow — the patient-first counter desk is the default. */
  async getBillingFlow(): Promise<BillingFlow> {
    const [row] = await this.db
      .select()
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, BILLING_FLOW_KEY))
      .limit(1);
    const value = row?.value as { flow?: BillingFlow } | undefined;
    return value?.flow === "old" ? "old" : "new";
  }

  /** Persist the billing flow switch. Super admin only — enforced by RolesGuard. */
  async setBillingFlow(flow: BillingFlow, actorId: string) {
    await this.db
      .insert(schema.appSettings)
      .values({
        key: BILLING_FLOW_KEY,
        value: { flow },
        updatedBy: actorId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.appSettings.key,
        set: {
          value: { flow },
          updatedBy: actorId,
          updatedAt: new Date(),
        },
      });
    return { billingFlow: flow };
  }
}
