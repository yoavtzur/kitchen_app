import { addDays } from './date';
import type { OrderLine } from '../types';

/**
 * The order-history grid, one week at a time. `weeksBack` 0 is the last seven days ending today
 * (what the grid always showed); 1 is the seven before that, and so on. Order lines are kept with
 * no age limit, so going back is only a matter of which dates to read.
 */
export const HISTORY_DAYS = 7;
/** How far back the "unusually large" comparison looks: four weeks, not just the week on screen,
 * so a whole heavy week is still measured against normal ones. */
export const BASELINE_DAYS = 28;

export function historyDates(today: string, weeksBack: number): string[] {
  const end = addDays(today, -HISTORY_DAYS * Math.max(0, weeksBack));
  return Array.from({ length: HISTORY_DAYS }, (_, i) => addDays(end, -(HISTORY_DAYS - 1 - i)));
}

/** "21/9 – 27/9" */
export function historyRangeLabel(dates: string[]): string {
  const fmt = (d: string) => {
    const [, m, day] = d.split('-');
    return `${Number(day)}/${Number(m)}`;
  };
  return `${fmt(dates[0])} – ${fmt(dates[dates.length - 1])}`;
}

/** Ordered quantities for one ingredient over the `BASELINE_DAYS` ending on `endDate`. */
export function baselineValues(lines: OrderLine[], ingredientId: string, endDate: string): number[] {
  const start = addDays(endDate, -(BASELINE_DAYS - 1));
  return lines
    .filter(
      (l) =>
        l.ingredientId === ingredientId &&
        l.date >= start &&
        l.date <= endDate &&
        typeof l.qtyOverride === 'number',
    )
    .map((l) => l.qtyOverride as number);
}

/** Yellow at 1.5× the ingredient's own mean, red at 2×; nothing with fewer than three data points. */
export function historyHighlight(value: number | undefined, baseline: number[]): 'red' | 'yellow' | undefined {
  if (value === undefined || baseline.length < 3) return undefined;
  const mean = baseline.reduce((a, b) => a + b, 0) / baseline.length;
  if (mean <= 0) return undefined;
  if (value > mean * 2) return 'red';
  if (value > mean * 1.5) return 'yellow';
  return undefined;
}
