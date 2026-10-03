import { describe, expect, it } from 'vitest';
import { baselineValues, historyDates, historyHighlight, historyRangeLabel } from '../orderHistory';
import type { OrderLine } from '../../types';

describe('orderHistory', () => {
  it('this week ends today; each step back is seven days earlier', () => {
    expect(historyDates('2026-10-03', 0)).toEqual([
      '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03',
    ]);
    const prev = historyDates('2026-10-03', 1);
    expect(prev[0]).toBe('2026-09-20');
    expect(prev[6]).toBe('2026-09-26');
    expect(historyDates('2026-10-03', -3)).toEqual(historyDates('2026-10-03', 0));
  });

  it('labels the range', () => {
    expect(historyRangeLabel(historyDates('2026-10-03', 1))).toBe('20/9 – 26/9');
  });

  it('baseline is the four weeks ending at the window, with a quantity', () => {
    const lines = [
      { ingredientId: 'a', date: '2026-09-05', qtyOverride: 100 }, // day 29 back → outside
      { ingredientId: 'a', date: '2026-09-06', qtyOverride: 1 }, // day 28 → inside
      { ingredientId: 'a', date: '2026-10-03', qtyOverride: 2 },
      { ingredientId: 'a', date: '2026-10-04', qtyOverride: 3 },
      { ingredientId: 'b', date: '2026-10-01', qtyOverride: 9 },
      { ingredientId: 'a', date: '2026-10-01' },
    ] as OrderLine[];
    expect(baselineValues(lines, 'a', '2026-10-03')).toEqual([1, 2]);
  });

  it('highlights against the mean, never with under three points', () => {
    expect(historyHighlight(10, [2, 2])).toBeUndefined();
    expect(historyHighlight(5, [2, 2, 2])).toBe('red');
    expect(historyHighlight(3.5, [2, 2, 2])).toBe('yellow');
    expect(historyHighlight(2, [2, 2, 2])).toBeUndefined();
    expect(historyHighlight(undefined, [2, 2, 2])).toBeUndefined();
    expect(historyHighlight(5, [0, 0, 0])).toBeUndefined();
  });
});
