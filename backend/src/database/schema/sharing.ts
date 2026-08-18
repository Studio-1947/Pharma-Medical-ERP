import {
  pgTable,
  uuid,
  integer,
  timestamp,
  varchar,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { patients } from "./billing";
import { branches } from "./branches";
import { users } from "./auth";

/**
 * Revocable links that let a patient open one prescription or bill without
 * signing in.
 *
 * The token is a random secret stored here rather than the record's own id.
 * That matters for three reasons: the same id appears in staff URLs and server
 * logs, so reusing it would make any leak permanent; a secret can be revoked
 * the moment a link is forwarded to the wrong person; and it can carry an
 * expiry, which an entity id cannot.
 *
 * Nothing here stores clinical data. The row is a capability pointing at a
 * record, and the endpoint that resolves it returns a deliberately narrow
 * projection.
 */
export const recordShareLinks = pgTable(
  "record_share_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** URL-safe random secret. Unique so a lookup is a single indexed hit. */
    token: varchar("token", { length: 64 }).notNull().unique(),

    /** "prescription" | "invoice". Kept as varchar so adding a shareable
     *  record type later does not require an enum migration. */
    resourceType: varchar("resource_type", { length: 20 }).notNull(),
    resourceId: uuid("resource_id").notNull(),

    /** Denormalised for audit: answers "what was shared about this patient"
     *  without joining through two record types. */
    patientId: uuid("patient_id").references(() => patients.id, {
      onDelete: "cascade",
    }),
    branchId: uuid("branch_id").references(() => branches.id, {
      onDelete: "set null",
    }),

    /** Hard stop. A link past this is refused even if never revoked. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Set when staff kill a link early; checked before expiry. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),

    // Access trail. A patient link is a disclosure of health information, so
    // how often it was opened and when it was last opened are worth keeping.
    viewCount: integer("view_count").notNull().default(0),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),

    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    // Every public request is a lookup by token.
    tokenIdx: index("record_share_links_token_idx").on(t.token),
    // Powers "show existing links for this record" and bulk revoke.
    resourceIdx: index("record_share_links_resource_idx").on(
      t.resourceType,
      t.resourceId,
    ),
    patientIdx: index("record_share_links_patient_idx").on(t.patientId),
  }),
);

export const recordShareLinksRelations = relations(
  recordShareLinks,
  ({ one }) => ({
    patient: one(patients, {
      fields: [recordShareLinks.patientId],
      references: [patients.id],
    }),
    branch: one(branches, {
      fields: [recordShareLinks.branchId],
      references: [branches.id],
    }),
    createdByUser: one(users, {
      fields: [recordShareLinks.createdBy],
      references: [users.id],
    }),
  }),
);
