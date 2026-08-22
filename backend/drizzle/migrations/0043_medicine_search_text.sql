-- Counter search: one indexed predicate instead of thirteen ILIKEs per pass.
--
-- drizzle-kit 0.22.8 does not emit GENERATED ALWAYS AS, so this file is
-- hand-written. Its snapshot records search_text as a plain nullable text
-- column, which is what keeps later `db:generate` runs from churning on it.
--
-- Measured on 6,795 rows: 140ms sequential scan -> 1.5ms bitmap index scan.
-- The old plan was linear in table size, so the gap widens with the catalogue.
ALTER TABLE "medicines" DROP COLUMN IF EXISTS "search_text";--> statement-breakpoint

-- Both forms in one column: the lower-cased text, then the same text with
-- punctuation stripped. That is what makes "pan-40", "pan 40" and "pan40" a
-- single query rather than a second pass over a second expression.
ALTER TABLE "medicines" ADD COLUMN "search_text" text
  GENERATED ALWAYS AS (
    lower(coalesce("name",'') || ' ' || coalesce("brand_name",'') || ' ' || coalesce("generic_name",'') || ' ' || coalesce("composition",'') || ' ' || coalesce("manufacturer",'') || ' ' || coalesce("sku",'') || ' ' || coalesce("barcode",'') || ' ' || coalesce("strength",'') || ' ' || coalesce("dosage_form",'') || ' ' || coalesce("therapeutic_class",'') || ' ' || coalesce("pack_size",'') || ' ' || coalesce("hsn_code",'') || ' ' || coalesce("drawer_mapping",''))
    || ' ' ||
    regexp_replace(lower(coalesce("name",'') || ' ' || coalesce("brand_name",'') || ' ' || coalesce("generic_name",'') || ' ' || coalesce("composition",'') || ' ' || coalesce("manufacturer",'') || ' ' || coalesce("sku",'') || ' ' || coalesce("barcode",'') || ' ' || coalesce("strength",'') || ' ' || coalesce("dosage_form",'') || ' ' || coalesce("therapeutic_class",'') || ' ' || coalesce("pack_size",'') || ' ' || coalesce("hsn_code",'') || ' ' || coalesce("drawer_mapping",'')), '[^a-z0-9]', '', 'g')
  ) STORED;--> statement-breakpoint

-- Trigram matching is what makes a leading-wildcard LIKE indexable at all.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint

-- Not managed by drizzle: it cannot express the gin_trgm_ops operator class.
-- Dropping this index silently returns the search to a sequential scan.
CREATE INDEX IF NOT EXISTS "medicines_search_trgm_idx"
  ON "medicines" USING gin ("search_text" gin_trgm_ops);
