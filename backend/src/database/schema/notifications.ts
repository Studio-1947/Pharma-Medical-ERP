import { pgTable, uuid, varchar, boolean, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { users } from "./auth";

export const notificationTypeEnum = pgEnum("notification_type", [
  "low_stock",
  "near_expiry",
  "expired",
  "reorder",
  "invoice",
  "prescription",
  "system",
]);

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  type: notificationTypeEnum("type").notNull().default("system"),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  resourceType: varchar("resource_type", { length: 50 }),
  resourceId: uuid("resource_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
