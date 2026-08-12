import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { join } from "node:path";

import * as schema from "./schema";

// Shared constant so every instance contends for the same lock.
const MIGRATION_LOCK_KEY = 9471001;

/**
 * Applies pending Drizzle migrations against DATABASE_URL, then returns.
 *
 * Runs inside the container (which sits in the VPC and can reach the private
 * DB) because no external runner can — the prod DB is only reachable from
 * inside the network. Idempotent: drizzle skips migrations already recorded in
 * __drizzle_migrations. A Postgres advisory lock serializes concurrent
 * instances so a scale-up burst can't race the migrator.
 */
export async function runMigrations(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set - cannot run migrations");
  }

  const pool = new Pool({ connectionString, max: 1 });
  const db = drizzle(pool, { schema });
  const migrationsFolder = join(process.cwd(), "drizzle", "migrations");

  try {
    await db.execute(sql`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY}::bigint)`);
    try {
      await migrate(db, { migrationsFolder });
      console.log("[migrations] schema up to date");

      // Seed data is never created during application boot. An empty production
      // database is an operational state, not authorization to insert demo data.
    } finally {
      await db.execute(sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY}::bigint)`);
    }
  } finally {
    await pool.end();
  }
}
