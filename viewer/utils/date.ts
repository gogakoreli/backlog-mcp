/**
 * Date utilities for the activity panel and other viewer components.
 * Uses native APIs - no external dependencies.
 */

export const MS_PER_DAY = 86400000;

/**
 * Format a Date as YYYY-MM-DD in local timezone.
 * Returns null for invalid dates.
 */
export function getLocalDateKey(date: Date): string | null {
  try {
    if (!(date instanceof Date) || isNaN(date.getTime())) {
      return null;
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch {
    return null;
  }
}

/**
 * Get today's date key in local timezone.
 * Returns empty string if date formatting fails (should never happen).
 */
export function getTodayKey(): string {
  return getLocalDateKey(new Date()) ?? '';
}

/**
 * Get yesterday's date key in local timezone.
 * Returns empty string if date formatting fails (should never happen).
 */
export function getYesterdayKey(): string {
  return getLocalDateKey(new Date(Date.now() - MS_PER_DAY)) ?? '';
}

/**
 * Parse a YYYY-MM-DD date key into a Date object at noon local time.
 * Using noon avoids DST edge cases at midnight.
 * Returns null for invalid input.
 */
export function parseLocalDate(dateKey: string): Date | null {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      return null;
    }
    const date = new Date(dateKey + 'T12:00:00');
    if (isNaN(date.getTime())) {
      return null;
    }
    return date;
  } catch {
    return null;
  }
}

/**
 * Add days to a date key. Negative values subtract days.
 * Returns null for invalid input.
 */
export function addDays(dateKey: string, days: number): string | null {
  const date = parseLocalDate(dateKey);
  if (!date) return null;
  date.setDate(date.getDate() + days);
  return getLocalDateKey(date);
}

export interface FormatOptions {
  /** Use short format (e.g., "Jan 5") instead of full format */
  short?: boolean;
}

/**
 * Format a date key as a human-readable label.
 * Returns "Today", "Yesterday", or a formatted date string.
 */
export function formatRelativeDay(dateKey: string, options?: FormatOptions): string {
  const today = getTodayKey();
  const yesterday = getYesterdayKey();
  
  if (dateKey === today) return 'Today';
  if (dateKey === yesterday) return 'Yesterday';
  
  const date = parseLocalDate(dateKey);
  if (!date) return dateKey; // Fallback to raw key if invalid
  
  if (options?.short) {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  
  return date.toLocaleDateString(undefined, { 
    weekday: 'long', 
    month: 'long', 
    day: 'numeric', 
    year: 'numeric' 
  });
}

/**
 * Format a timestamp as time string (e.g., "2:30 PM").
 */
export function formatTime(date: Date): string {
  try {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

/**
 * Format a timestamp as short date + time (e.g., "Jan 5, 2:30 PM").
 */
export function formatDateTime(date: Date): string {
  try {
    const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const timeStr = formatTime(date);
    return `${dateStr}, ${timeStr}`;
  } catch {
    return '';
  }
}

/**
 * Check if a date is today.
 */
export function isToday(date: Date): boolean {
  return getLocalDateKey(date) === getTodayKey();
}

/**
 * Check if a date is yesterday.
 */
export function isYesterday(date: Date): boolean {
  return getLocalDateKey(date) === getYesterdayKey();
}
