import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MS_PER_DAY,
  getLocalDateKey,
  getTodayKey,
  getYesterdayKey,
  parseLocalDate,
  addDays,
  formatRelativeDay,
  formatTime,
  formatDateTime,
  isToday,
  isYesterday,
} from './date.js';

describe('date utilities', () => {
  describe('MS_PER_DAY', () => {
    it('equals 86400000 milliseconds', () => {
      expect(MS_PER_DAY).toBe(86400000);
      expect(MS_PER_DAY).toBe(24 * 60 * 60 * 1000);
    });
  });

  describe('getLocalDateKey', () => {
    it('formats date as YYYY-MM-DD', () => {
      const date = new Date(2026, 1, 5); // Feb 5, 2026
      expect(getLocalDateKey(date)).toBe('2026-02-05');
    });

    it('pads single-digit months and days', () => {
      const date = new Date(2026, 0, 3); // Jan 3, 2026
      expect(getLocalDateKey(date)).toBe('2026-01-03');
    });

    it('returns null for invalid date', () => {
      expect(getLocalDateKey(new Date('invalid'))).toBeNull();
    });

    it('returns null for non-Date input', () => {
      expect(getLocalDateKey('2026-02-05' as any)).toBeNull();
      expect(getLocalDateKey(null as any)).toBeNull();
      expect(getLocalDateKey(undefined as any)).toBeNull();
    });
  });

  describe('getTodayKey', () => {
    it('returns today in YYYY-MM-DD format', () => {
      const today = new Date();
      const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      expect(getTodayKey()).toBe(expected);
    });
  });

  describe('getYesterdayKey', () => {
    it('returns yesterday in YYYY-MM-DD format', () => {
      const yesterday = new Date(Date.now() - MS_PER_DAY);
      const expected = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
      expect(getYesterdayKey()).toBe(expected);
    });
  });

  describe('parseLocalDate', () => {
    it('parses valid YYYY-MM-DD string', () => {
      const date = parseLocalDate('2026-02-05');
      expect(date).toBeInstanceOf(Date);
      expect(date!.getFullYear()).toBe(2026);
      expect(date!.getMonth()).toBe(1); // 0-indexed
      expect(date!.getDate()).toBe(5);
    });

    it('sets time to noon to avoid DST issues', () => {
      const date = parseLocalDate('2026-02-05');
      expect(date!.getHours()).toBe(12);
    });

    it('returns null for invalid format', () => {
      expect(parseLocalDate('2026-2-5')).toBeNull();
      expect(parseLocalDate('02-05-2026')).toBeNull();
      expect(parseLocalDate('invalid')).toBeNull();
      expect(parseLocalDate('')).toBeNull();
    });

    it('returns null for invalid date values', () => {
      // Note: JavaScript auto-corrects some invalid dates (Feb 30 → Mar 2)
      // We only catch truly invalid strings that fail to parse
      expect(parseLocalDate('2026-00-01')).toBeNull(); // Month 0 is invalid
      expect(parseLocalDate('2026-02-00')).toBeNull(); // Day 0 is invalid
    });
  });

  describe('addDays', () => {
    it('adds positive days', () => {
      expect(addDays('2026-02-05', 1)).toBe('2026-02-06');
      expect(addDays('2026-02-05', 7)).toBe('2026-02-12');
    });

    it('subtracts with negative days', () => {
      expect(addDays('2026-02-05', -1)).toBe('2026-02-04');
      expect(addDays('2026-02-05', -5)).toBe('2026-01-31');
    });

    it('handles month boundaries', () => {
      expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
      expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    });

    it('handles year boundaries', () => {
      expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
      expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    });

    it('returns null for invalid input', () => {
      expect(addDays('invalid', 1)).toBeNull();
    });
  });

  describe('formatRelativeDay', () => {
    let realDateNow: () => number;

    beforeEach(() => {
      realDateNow = Date.now;
      // Mock Date.now to return Feb 5, 2026 at noon
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 1, 5, 12, 0, 0));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns "Today" for today', () => {
      expect(formatRelativeDay('2026-02-05')).toBe('Today');
    });

    it('returns "Yesterday" for yesterday', () => {
      expect(formatRelativeDay('2026-02-04')).toBe('Yesterday');
    });

    it('returns formatted date for other days', () => {
      const result = formatRelativeDay('2026-02-01');
      expect(result).toContain('February');
      expect(result).toContain('1');
      expect(result).toContain('2026');
    });

    it('returns short format when requested', () => {
      const result = formatRelativeDay('2026-02-01', { short: true });
      expect(result).toContain('Feb');
      expect(result).toContain('1');
      expect(result).not.toContain('2026');
    });

    it('returns raw key for invalid date', () => {
      expect(formatRelativeDay('invalid')).toBe('invalid');
    });
  });

  describe('formatTime', () => {
    it('formats time as HH:MM AM/PM', () => {
      const date = new Date(2026, 1, 5, 14, 30);
      const result = formatTime(date);
      expect(result).toMatch(/2:30|14:30/); // Depends on locale
    });
  });

  describe('formatDateTime', () => {
    it('formats as short date + time', () => {
      const date = new Date(2026, 1, 5, 14, 30);
      const result = formatDateTime(date);
      expect(result).toContain('Feb');
      expect(result).toContain('5');
    });
  });

  describe('isToday', () => {
    it('returns true for today', () => {
      expect(isToday(new Date())).toBe(true);
    });

    it('returns false for yesterday', () => {
      expect(isToday(new Date(Date.now() - MS_PER_DAY))).toBe(false);
    });
  });

  describe('isYesterday', () => {
    it('returns true for yesterday', () => {
      expect(isYesterday(new Date(Date.now() - MS_PER_DAY))).toBe(true);
    });

    it('returns false for today', () => {
      expect(isYesterday(new Date())).toBe(false);
    });
  });
});
