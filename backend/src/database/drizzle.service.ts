import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

@Injectable()
export class DrizzleService implements OnModuleInit, OnModuleDestroy {
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
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
