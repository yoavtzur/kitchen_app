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

/** Whole days from `from` to `to` (negative if `to` is earlier). Built on local-midnight dates, so a
 * daylight-saving change in between cannot make a day 23 or 25 hours long and skew the count. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
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

/** Composite key for a dated OrderLine — covers React keys and map lookups without a stored
 * id field that could drift from its own (ingredientId, date) components. */
export function orderLineKey(ingredientId: string, date: string): string {
  return `${ingredientId}__${date}`;
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

/** "3/10" — a date as a cook writes it on a label, with no year. */
export function formatDayMonth(dateStr: string): string {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${d}/${m}`;
}
