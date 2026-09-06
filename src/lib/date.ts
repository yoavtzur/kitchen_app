import type { Weekday } from '../types';

export function todayStr(): string {
  return toDateStr(new Date());
}

export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return toDateStr(dt);
}

/** 0=Sunday .. 6=Saturday, matching Date#getDay(). */
export function dayOfWeek(dateStr: string): Weekday {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getDay() as Weekday;
}

const HE_DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const HE_DAY_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

export function dayName(dateStr: string): string {
  return HE_DAY_NAMES[dayOfWeek(dateStr)];
}

export function dayShortLabel(weekday: Weekday): string {
  return HE_DAY_SHORT[weekday];
}

/** Returns the 7 date strings of the week containing dateStr, starting on weekStartsOn (0=Sun,1=Mon). */
export function weekDates(dateStr: string, weekStartsOn: 0 | 1): string[] {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = dt.getDay();
  const diff = (dow - weekStartsOn + 7) % 7;
  const start = new Date(dt);
  start.setDate(start.getDate() - diff);
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(start);
    day.setDate(day.getDate() + i);
    return toDateStr(day);
  });
}
