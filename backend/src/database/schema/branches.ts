import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  text,
  boolean,
} from "drizzle-orm/pg-core";

/**
 * Branches — the top-level tenancy boundary for everything transactional.
 *
 * Lives in its own file with no imports on purpose. Almost every other schema
 * file needs to reference it, and while it sat in distribution.ts (which
 * imports inventory.ts) a branch FK from inventory.ts would have closed an
 * import cycle. The result was that every `branch_id` in the database was a
 * bare uuid with no foreign key at all — nothing stopped a row pointing at a
 * branch that never existed.
 *
 * Keeping this a leaf module is what lets those FKs exist.
 */
export const branches = pgTable("branches", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 20 }).notNull().unique(),
  address: text("address").notNull(),
  phone: varchar("phone", { length: 20 }),
  email: varchar("email", { length: 255 }),
  isHeadOffice: boolean("is_head_office").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  // Drives intra- vs inter-state GST on invoices raised by this branch.
  state: varchar("state", { length: 100 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
