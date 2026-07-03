import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import argon2 from "argon2";
import * as schema from "./schema";

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const db = drizzle(pool, { schema });

async function seedAdmin() {
  console.log("Seeding super_admin user...");

  const passwordHash = await argon2.hash("RadhaMadhav@123", {
    type: argon2.argon2id,
    timeCost: 2,
    memoryCost: 65536,
    parallelism: 1,
  });

  await db
    .insert(schema.users)
    .values({
      email: "rkmc@email.com",
      passwordHash,
      role: "super_admin" as const,
      branchId: null,
    })
    .onConflictDoNothing({ target: schema.users.email });

  console.log("Done.");
}

seedAdmin()
  .then(() => {
    pool.end();
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    pool.end();
    process.exit(1);
  });
