/**
 * Formatting for the clinic's consultation clock.
 *
 * `calledAt` and `completedAt` are stamped by the server on the status
 * transition, so both are plain ISO strings here and either may be absent —
 * a token that is still waiting has neither.
 */

/** "3:04 PM", or null when the timestamp is absent. */
export function formatClockTime(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Whole minutes between two timestamps, or null if either is missing. */
export function durationMinutes(
  from?: string | null,
  to?: string | null,
): number | null {
  if (!from || !to) return null;
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return Math.round((end - start) / 60000);
}

/** "8m" / "1h 12m". Sub-minute consultations read as "<1m", not "0m". */
export function formatDuration(minutes: number | null): string | null {
  if (minutes === null) return null;
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * Live elapsed time for a consultation in progress — called but not yet
 * completed. Callers re-render on a timer to keep it moving.
 */
export function elapsedSince(iso?: string | null, now = Date.now()): string | null {
  if (!iso) return null;
  const start = new Date(iso).getTime();
  if (Number.isNaN(start) || now < start) return null;
  return formatDuration(Math.round((now - start) / 60000));
}
