import type { Config } from "drizzle-kit";

export default {
  schema: "./src/database/schema/index.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: (process.env.DB_TARGET === "prod" ? process.env.DATABASE_URL_PROD : process.env.DATABASE_URL)!,
  },
  verbose: true,
  strict: true,
} satisfies Config;
