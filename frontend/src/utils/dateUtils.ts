/**
 * SNIST ERP - IST Timezone-Safe Calendar & Date Utilities
 * Phase 2: Calendar Foundation, Data Mapping & Safe Integration Layer
 * 
 * Rules:
 * - Server-authoritative IST (Asia/Kolkata, UTC+05:30).
 * - Avoid new Date("YYYY-MM-DD") UTC off-by-one parsing bugs.
 * - Pure functions with zero external dependencies.
 */

import type { PeriodDefinition } from '../types/calendar.ts';

export const IST_TIMEZONE = 'Asia/Kolkata';

/**
 * Institutional Standard Periods (SNIST Academic Schedule)
 * Standardized across backend and frontend.
 */
export const STANDARD_PERIODS: PeriodDefinition[] = [
  { num: 1, label: 'Period 1', startTime: '09:30', endTime: '10:20', displayTime: '09:30 AM - 10:20 AM' },
  { num: 2, label: 'Period 2', startTime: '10:20', endTime: '11:10', displayTime: '10:20 AM - 11:10 AM' },
  { num: 3, label: 'Period 3', startTime: '11:20', endTime: '12:10', displayTime: '11:20 AM - 12:10 PM' },
  { num: 4, label: 'Period 4', startTime: '12:10', endTime: '13:00', displayTime: '12:10 PM - 01:00 PM' },
  { num: 5, label: 'Period 5', startTime: '13:40', endTime: '14:30', displayTime: '01:40 PM - 02:30 PM' },
  { num: 6, label: 'Period 6', startTime: '14:30', endTime: '15:20', displayTime: '02:30 PM - 03:20 PM' },
  { num: 7, label: 'Period 7', startTime: '15:20', endTime: '16:10', displayTime: '03:20 PM - 04:10 PM' },
  { num: 8, label: 'Period 8', startTime: '16:10', endTime: '17:00', displayTime: '04:10 PM - 05:00 PM' },
];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const DAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
];

const DAY_SHORT_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Returns today's calendar date in server-authoritative IST as "YYYY-MM-DD".
 * Uses Intl.DateTimeFormat with Asia/Kolkata to guarantee immunity to local browser timezone differences.
 */
export function getTodayIST(): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: IST_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return formatter.format(new Date());
  } catch {
    // Fallback calculation in case Intl fails (e.g. older JS environment)
    const now = new Date();
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    const istMs = utcMs + 5.5 * 3600000;
    const istDate = new Date(istMs);
    const y = istDate.getFullYear();
    const m = String(istDate.getMonth() + 1).padStart(2, '0');
    const d = String(istDate.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}

/**
 * Returns the current time in server-authoritative IST as "HH:MM" (24-hour format).
 */
export function getCurrentTimeIST(): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: IST_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    return formatter.format(new Date());
  } catch {
    const now = new Date();
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    const istMs = utcMs + 5.5 * 3600000;
    const istDate = new Date(istMs);
    const h = String(istDate.getHours()).padStart(2, '0');
    const min = String(istDate.getMinutes()).padStart(2, '0');
    return `${h}:${min}`;
  }
}

/**
 * Timezone-safe date component parser.
 * Given "YYYY-MM-DD", returns numeric year, month (1-12), and day (1-31).
 */
export function parseDateComponents(dateStr: string): { year: number; month: number; day: number } {
  if (!dateStr || typeof dateStr !== 'string') {
    const today = getTodayIST();
    const parts = today.split('-').map(Number);
    return { year: parts[0] || 2026, month: parts[1] || 1, day: parts[2] || 1 };
  }
  const parts = dateStr.trim().split('-').map(Number);
  const year = parts[0] || 2026;
  const month = parts[1] || 1;
  const day = parts[2] || 1;
  return { year, month, day };
}

/**
 * Formats "YYYY-MM-DD" into human-friendly full display: "Friday, 12 September 2025".
 */
export function formatISTDisplayDate(dateStr: string): string {
  const { year, month, day } = parseDateComponents(dateStr);
  const dateObj = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = dateObj.getUTCDay();
  const dayName = DAY_NAMES[dayOfWeek] || '';
  const monthName = MONTH_NAMES[month - 1] || '';
  return `${dayName}, ${day} ${monthName} ${year}`;
}

/**
 * Formats a year and month (1-indexed) into "September 2025".
 */
export function formatISTMonthYear(year: number, month: number): string {
  const monthName = MONTH_NAMES[month - 1] || 'Unknown';
  return `${monthName} ${year}`;
}

/**
 * Compares two "YYYY-MM-DD" strings for equality.
 */
export function isSameDate(d1?: string | null, d2?: string | null): boolean {
  if (!d1 || !d2) return false;
  return d1.trim() === d2.trim();
}

/**
 * Returns true if d1 is strictly before d2 ("YYYY-MM-DD").
 */
export function isDateBefore(d1: string, d2: string): boolean {
  if (!d1 || !d2) return false;
  return d1.trim() < d2.trim();
}

/**
 * Returns true if d1 is strictly after d2 ("YYYY-MM-DD").
 */
export function isDateAfter(d1: string, d2: string): boolean {
  if (!d1 || !d2) return false;
  return d1.trim() > d2.trim();
}

/**
 * Adds (or subtracts) days from a "YYYY-MM-DD" date string in a timezone-safe manner.
 */
export function addDays(dateStr: string, days: number): string {
  const { year, month, day } = parseDateComponents(dateStr);
  const dateObj = new Date(Date.UTC(year, month - 1, day + days));
  const y = dateObj.getUTCFullYear();
  const m = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Returns the number of days in a given year and month (1-indexed).
 */
export function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Generates the full 35 or 42 grid cells for a calendar month view.
 * Starts on Sunday (index 0) and includes leading days from previous month and trailing days from next month.
 */
export function getMonthGridDays(
  year: number,
  month: number, // 1 to 12
  selectedDate?: string,
  todayIST: string = getTodayIST()
): Array<{
  date: string;
  dayNumber: number;
  dayOfWeek: number;
  dayName: string;
  isCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
}> {
  const daysInCurrentMonth = getDaysInMonth(year, month);
  const firstDayOfWeek = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0 = Sun

  const grid: Array<{
    date: string;
    dayNumber: number;
    dayOfWeek: number;
    dayName: string;
    isCurrentMonth: boolean;
    isToday: boolean;
    isSelected: boolean;
  }> = [];

  // 1. Previous Month Leading Days
  const prevMonthYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const daysInPrevMonth = getDaysInMonth(prevMonthYear, prevMonth);

  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    const dayNum = daysInPrevMonth - i;
    const dateStr = `${prevMonthYear}-${String(prevMonth).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    const dayOfWeek = new Date(Date.UTC(prevMonthYear, prevMonth - 1, dayNum)).getUTCDay();
    grid.push({
      date: dateStr,
      dayNumber: dayNum,
      dayOfWeek,
      dayName: DAY_SHORT_NAMES[dayOfWeek] || '',
      isCurrentMonth: false,
      isToday: isSameDate(dateStr, todayIST),
      isSelected: isSameDate(dateStr, selectedDate)
    });
  }

  // 2. Current Month Days
  for (let dayNum = 1; dayNum <= daysInCurrentMonth; dayNum++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    const dayOfWeek = new Date(Date.UTC(year, month - 1, dayNum)).getUTCDay();
    grid.push({
      date: dateStr,
      dayNumber: dayNum,
      dayOfWeek,
      dayName: DAY_SHORT_NAMES[dayOfWeek] || '',
      isCurrentMonth: true,
      isToday: isSameDate(dateStr, todayIST),
      isSelected: isSameDate(dateStr, selectedDate)
    });
  }

  // 3. Next Month Trailing Days (fill up to complete 35 or 42 grid cells)
  const nextMonthYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const targetTotal = grid.length <= 35 ? 35 : 42;
  const remainingDays = targetTotal - grid.length;

  for (let dayNum = 1; dayNum <= remainingDays; dayNum++) {
    const dateStr = `${nextMonthYear}-${String(nextMonth).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    const dayOfWeek = new Date(Date.UTC(nextMonthYear, nextMonth - 1, dayNum)).getUTCDay();
    grid.push({
      date: dateStr,
      dayNumber: dayNum,
      dayOfWeek,
      dayName: DAY_SHORT_NAMES[dayOfWeek] || '',
      isCurrentMonth: false,
      isToday: isSameDate(dateStr, todayIST),
      isSelected: isSameDate(dateStr, selectedDate)
    });
  }

  return grid;
}

/**
 * Generates the 7 days of the week containing the anchor date (Sunday to Saturday).
 */
export function getWeekGridDays(
  anchorDate: string,
  selectedDate?: string,
  todayIST: string = getTodayIST()
): Array<{
  date: string;
  dayNumber: number;
  dayOfWeek: number;
  dayName: string;
  isToday: boolean;
  isSelected: boolean;
}> {
  const { year, month, day } = parseDateComponents(anchorDate);
  const anchorObj = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = anchorObj.getUTCDay(); // 0 = Sun, 6 = Sat

  const sundayDate = addDays(anchorDate, -dayOfWeek);
  const weekDays = [];

  for (let i = 0; i < 7; i++) {
    const dateStr = addDays(sundayDate, i);
    const { day: dNum } = parseDateComponents(dateStr);
    weekDays.push({
      date: dateStr,
      dayNumber: dNum,
      dayOfWeek: i,
      dayName: DAY_SHORT_NAMES[i] || '',
      isToday: isSameDate(dateStr, todayIST),
      isSelected: isSameDate(dateStr, selectedDate)
    });
  }

  return weekDays;
}

/**
 * Extracts numeric period number from period strings like "Period 2", "Period 1-4", "1".
 */
export function extractPeriodNumber(periodStr?: string | null): number {
  if (!periodStr) return 1;
  const match = periodStr.match(/\b(?:Period\s*)?(\d+)\b/i);
  if (match && match[1]) {
    const num = parseInt(match[1], 10);
    return isNaN(num) ? 1 : Math.max(1, Math.min(8, num));
  }
  return 1;
}

/**
 * Extracts period count credit from period strings like "Period 1-4 (4 Periods)".
 */
export function extractPeriodCount(periodStr?: string | null): number {
  if (!periodStr) return 1;
  const match = periodStr.match(/\((\d+)\s*periods?\)/i);
  if (match && match[1]) {
    const count = parseInt(match[1], 10);
    return isNaN(count) ? 1 : Math.max(1, Math.min(8, count));
  }
  if (periodStr.includes('-')) {
    const parts = periodStr.replace(/periods?/gi, '').split('-');
    if (parts.length >= 2) {
      const p0 = parseInt(parts[0].replace(/\D/g, ''), 10);
      const p1 = parseInt(parts[1].replace(/\D/g, ''), 10);
      if (!isNaN(p0) && !isNaN(p1)) return Math.max(1, Math.min(8, p1 - p0 + 1));
    }
  }
  const digits = periodStr.match(/\d+/g);
  if (digits && digits.length > 1) return Math.max(1, Math.min(8, digits.length));
  return 1;
}

/**
 * Given a period number (1 to 8), returns standard period slot metadata.
 */
export function getPeriodDefinition(periodNumber: number): PeriodDefinition {
  const pNum = Math.max(1, Math.min(8, periodNumber));
  const found = STANDARD_PERIODS.find(p => p.num === pNum);
  return found || STANDARD_PERIODS[0];
}

/**
 * Given a starting period and period count, returns combined period slot metadata
 * spanning the entire block duration (e.g. Period 1-4: 09:30 AM - 01:00 PM).
 */
export function getMultiPeriodDefinition(periodNumber: number, periodCount: number = 1): PeriodDefinition {
  const startNum = Math.max(1, Math.min(8, periodNumber));
  const pCount = Math.max(1, Math.min(8, periodCount));
  const endNum = Math.max(startNum, Math.min(8, startNum + pCount - 1));

  const startDef = getPeriodDefinition(startNum);
  const endDef = getPeriodDefinition(endNum);

  if (pCount === 1 || startNum === endNum) {
    return startDef;
  }

  const startDisplay = startDef.displayTime.split(' - ')[0] || startDef.displayTime;
  const endDisplay = endDef.displayTime.split(' - ')[1] || endDef.displayTime;

  return {
    num: startNum,
    label: `Period ${startNum}-${endNum} (${pCount} Periods)`,
    startTime: startDef.startTime,
    endTime: endDef.endTime,
    displayTime: `${startDisplay} - ${endDisplay}`
  };
}

/**
 * Detects current period number from an "HH:MM" 24-hour time string in IST.
 */
export function detectPeriodFromTime(timeStr?: string | null): number | null {
  if (!timeStr) return null;
  for (const p of STANDARD_PERIODS) {
    if (timeStr >= p.startTime && timeStr <= p.endTime) {
      return p.num;
    }
  }
  return null;
}
