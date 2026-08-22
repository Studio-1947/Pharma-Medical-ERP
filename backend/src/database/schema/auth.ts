import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  text,
  inet,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { userRoleEnum } from "./enums";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  firstName: varchar("first_name", { length: 100 }),
  lastName: varchar("last_name", { length: 100 }),
  role: userRoleEnum("role").notNull().default("shop_manager"),
  branchId: uuid("branch_id"),
  isActive: boolean("is_active").notNull().default(true),
  twoFaEnabled: boolean("two_fa_enabled").notNull().default(false),
  twoFaSecret: varchar("two_fa_secret", { length: 64 }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
  notificationPrefs: jsonb("notification_prefs").$type<Record<string, { email: boolean; sms: boolean }>>(),
  doctorProfile: jsonb("doctor_profile").$type<Record<string, any>>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const refreshTokens = pgTable("refresh_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 255 }).notNull().unique(),
  ipAddress: inet("ip_address"),
  userAgent: text("user_agent"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  // The token that superseded this one when it was rotated on refresh.
  //
  // revokedAt alone cannot say WHY a token died, and the two reasons need
  // opposite handling: a token retired by rotation may have a losing request
  // still in flight against it, while one killed by logout, a role change or
  // a deactivation must never authenticate anyone again. Only a row with this
  // column set is eligible for the concurrent-rotation grace in AuthService.
  //
  // Deliberately not a foreign key: deleteExpiredRefreshTokens sweeps this
  // table in bulk, and a self-referencing FK would make a whole expired chain
  // undeletable in one statement.
  replacedByTokenId: uuid("replaced_by_token_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  action: varchar("action", { length: 100 }).notNull(),
  entity: varchar("entity", { length: 100 }).notNull(),
  entityId: uuid("entity_id"),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  ipAddress: inet("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  refreshTokens: many(refreshTokens),
  auditLogs: many(auditLogs),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, { fields: [refreshTokens.userId], references: [users.id] }),
}));
export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, { fields: [auditLogs.userId], references: [users.id] }),
}));
