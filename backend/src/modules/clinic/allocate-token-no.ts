import { and, eq, sql } from "drizzle-orm";
import * as schema from "../../database/schema";

/**
 * The next queue number for a doctor on a given day: first patient in is 1,
 * then 2, and so on.
 *
 * MUST be called inside a transaction. It takes a transaction-scoped advisory
 * lock on doctor+date first, so two receptionists — or a receptionist and a
 * doctor registering a walk-in — cannot both read the same `max(token_no)` and
 * compute the same number. `clinic_tokens_doctor_date_token_idx` is unique, so
 * without the lock the loser of that race is rejected outright; the patient
 * then ends up in the queue with no number at all, which is worse than a
 * duplicate because nobody can call them.
 *
 * Lives here rather than in either repository because both the clinic queue
 * and the doctor's register-a-patient shortcut allocate numbers, and when the
 * two carried their own copies only one of them took the lock.
 */
export async function allocateTokenNo(
  tx: any,
  doctorId: string,
  date: string,
): Promise<number> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`${doctorId}:${date}`}))`,
  );

  const [{ maxToken } = { maxToken: 0 }] = await tx
    .select({
      maxToken: sql<number>`coalesce(max(${schema.clinicTokens.tokenNo}), 0)::int`,
    })
    .from(schema.clinicTokens)
    .where(
      and(
        eq(schema.clinicTokens.doctorId, doctorId),
        eq(schema.clinicTokens.date, date),
      ),
    );

  return (maxToken ?? 0) + 1;
}
