import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

@Injectable()
export class DrizzleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DrizzleService.name);
  public db!: ReturnType<typeof drizzle<typeof schema>>;
  private pool!: Pool;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    this.pool = new Pool({
      connectionString: this.config.getOrThrow<string>("DATABASE_URL"),
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 2_000,
    });

    this.db = drizzle(this.pool, {
      schema,
      logger: this.config.get("NODE_ENV") === "development",
    });

    await this.ensureSchemaUpToDate();
  }

  private async ensureSchemaUpToDate() {
    try {
      await this.pool.query(`
        ALTER TABLE branches ADD COLUMN IF NOT EXISTS state VARCHAR(100);
        ALTER TABLE branches ADD COLUMN IF NOT EXISTS gstin VARCHAR(15);
        ALTER TABLE branches ADD COLUMN IF NOT EXISTS drug_license_20b VARCHAR(100);
        ALTER TABLE branches ADD COLUMN IF NOT EXISTS drug_license_21b VARCHAR(100);
        ALTER TABLE branches ADD COLUMN IF NOT EXISTS licensee_name VARCHAR(255);
        ALTER TABLE medicines ADD COLUMN IF NOT EXISTS drawer_mapping VARCHAR(50);
      `);
      this.logger.log("Database schema columns verified & synchronized successfully.");
    } catch (err: any) {
      this.logger.warn(`Schema auto-sync warning: ${err?.message ?? err}`);
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
