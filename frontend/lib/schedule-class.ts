/**
 * Drug schedule classification, in one place.
 *
 * The catalogue stores the class in two spellings: the seed writes
 * "SCHEDULE_H", the imported catalogue (and the medicine form's dropdown)
 * writes the bare letter "H". Every screen that hard-coded one spelling was
 * silently wrong about the other — on the live database all 4,138 controlled
 * medicines use the short form, so the "SCHEDULE_H" lists matched nothing and
 * the prescription gate rested entirely on the requiresPrescription flag.
 *
 * Mirrors isControlledSchedule() in
 * backend/src/modules/billing/billing.service.ts. Keep the two in step.
 */

/** Prescription-only under the Drugs & Cosmetics Rules. */
const CONTROLLED = ["H", "H1", "X"];

/** "SCHEDULE_H1", " schedule-h1 ", "h1" → "H1". Empty/unknown → null. */
export function normalizeScheduleClass(raw?: string | null): string | null {
  const s = (raw ?? "").trim().toUpperCase().replace(/^SCHEDULE[_\s-]?/, "");
  return s && s !== "NA" ? s : null;
}

/** True for Schedule H, H1 or X, whichever spelling the row carries. */
export function isControlledScheduleClass(raw?: string | null): boolean {
  const s = normalizeScheduleClass(raw);
  return !!s && CONTROLLED.includes(s);
}

/** "Schedule H1" for display, or null when the class is not a controlled one. */
export function scheduleLabel(raw?: string | null): string | null {
  const s = normalizeScheduleClass(raw);
  return s && CONTROLLED.includes(s) ? `Schedule ${s}` : null;
}

/**
 * True when the row may not be dispensed without a prescription on record —
 * either because of its schedule, or because it is flagged explicitly.
 */
export function isControlledRow(m: {
  scheduleClass?: string | null;
  requiresPrescription?: boolean | null;
}): boolean {
  return !!m.requiresPrescription || isControlledScheduleClass(m.scheduleClass);
}
