import { z } from "zod";

/**
 * Boolean parsing for query-string parameters.
 *
 * z.coerce.boolean() is wrong for anything arriving in a URL: it runs
 * JavaScript's Boolean(), and every non-empty string is truthy, so "false"
 * parses as true. A `?flag=false` filter therefore behaves identically to
 * `?flag=true` and the negative case becomes unreachable. This was first hit on
 * patients (`?hasDues=false`) and again on medicines, where it left every
 * inactive medicine unreachable through the list endpoint.
 */
export const booleanFlag = z.preprocess(
  (v) => (typeof v === "string" ? ["true", "1", "yes"].includes(v.trim().toLowerCase()) : v),
  z.boolean(),
);

/**
 * Tri-state variant for filters that must also be able to say "do not filter at
 * all". "all" drops the condition; "true"/"false" select one side. Omitting the
 * parameter entirely leaves the endpoint's own default in force, which is why
 * "all" has to be spelled out rather than inferred from absence.
 */
export const booleanFilter = z.union([z.literal("all"), booleanFlag]);

/** true | false | "all" */
export type BooleanFilter = z.infer<typeof booleanFilter>;
