/**
 * Shared date utilities — pure functions, no DOM or Node APIs.
 * Used by both server (src/) and viewer (viewer/) via re-export.
 */

/**
 * Convert a UTC ISO timestamp to a YYYY-MM-DD date key in a given timezone.
 * @param isoTimestamp - UTC timestamp (e.g. "2026-02-12T03:32:40.563Z")
 * @param tzOffsetMinutes - Timezone offset in minutes from Date.getTimezoneOffset()
 *                          (e.g. 480 for PST/UTC-8, -60 for CET/UTC+1)
 * @returns YYYY-MM-DD string in the target timezone, or null if invalid
 */
export function utcToLocalDateKey(isoTimestamp: string, tzOffsetMinutes: number): string | null {
  const ms = Date.parse(isoTimestamp);
  if (isNaN(ms)) return null;
  const d = new Date(ms - tzOffsetMinutes * 60_000);
  return d.toISOString().slice(0, 10);
}

/**
 * Format a Date as YYYY-MM-DD in the runtime's local timezone.
 * Returns null for invalid dates.
 */
export function getLocalDateKey(date: Date): string | null {
  if (!(date instanceof Date) || isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
