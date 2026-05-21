/** Format a date value as a short Indian locale string: "15 Jun 2024" */
export function formatDateIN(value: string | Date | null | undefined): string {
  if (!value) return "--";
  return new Date(value).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Format as datetime: "15 Jun 2024, 3:42 PM" */
export function formatDateTimeIN(value: string | Date | null | undefined): string {
  if (!value) return "--";
  return new Date(value).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Returns today's ISO date string "YYYY-MM-DD" */
export function todayISO(): string {
  return new Date().toISOString().split("T")[0]!;
}

/** Returns how many days until a date (negative = expired) */
export function daysUntil(date: string | Date): number {
  const ms = new Date(date).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}
