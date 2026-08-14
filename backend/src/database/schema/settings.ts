import {
  pgTable,
  varchar,
  jsonb,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

/**
 * Global application settings, one row per key.
 *
 * This is the home for installation-wide switches that are not tied to a
 * branch or a user — the billing flow toggle (legacy POS vs patient-first
 * counter desk) is the first consumer. Values are free-form JSON so new
 * settings do not need a schema change; keys are stable identifiers.
 */
export const appSettings = pgTable("app_settings", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: jsonb("value").notNull().default({}),
  updatedBy: uuid("updated_by").references(() => users.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
