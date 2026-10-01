import { describe, expect, it } from 'vitest';
import { expiredItems, expiryStatus, extendedExpiry } from '../expiry';
import type { AppState } from '../../types';

const today = '2026-10-10';

function state(overrides: Partial<AppState> = {}): AppState {
  return {
    schemaVersion: 5,
    settings: { defaultCoverageDays: 1, weekStartsOn: 0, roundMultiplierTo: 0.25 },
    cooks: [],
    stations: [],
    ingredients: [],
    products: [],
    recipes: [],
    tasks: [],
    taskOverrides: [],
    specialEvents: [],
    dayPlans: [],
    orderLines: [],
    ...overrides,
  };
}

const ing = (id: string, over: Partial<AppState['ingredients'][number]> = {}) => ({
  id,
  name: id,
  unit: 'kg' as const,
  currentQty: 2,
  dailyUsage: 1,
  weeklyUsage: 7,
  ...over,
});

describe('expiryStatus', () => {
  it('has no status without a date', () => {
    expect(expiryStatus(undefined, today)).toBe('none');
    expect(expiryStatus('', today)).toBe('none');
  });

  it('treats the date itself as the last good day', () => {
    expect(expiryStatus('2026-10-09', today)).toBe('expired');
    expect(expiryStatus('2026-10-10', today)).toBe('soon');
    expect(expiryStatus('2026-10-11', today)).toBe('soon');
    expect(expiryStatus('2026-10-12', today)).toBe('ok');
  });
});

describe('expiredItems', () => {
  it('lists only items past their date that still have stock, most overdue first', () => {
    const items = expiredItems(
      state({
        ingredients: [
          ing('a', { expiresOn: '2026-10-09' }),
          ing('b', { expiresOn: '2026-10-05' }),
          ing('used-up', { expiresOn: '2026-10-01', currentQty: 0 }),
          ing('fine', { expiresOn: '2026-10-20' }),
          ing('undated'),
        ],
        products: [
          { id: 'p', name: 'p', kind: 'component', unit: 'unit', currentQty: 4, weeklyTarget: 0, dailyUsage: 0, expiresOn: '2026-10-08' },
        ],
      }),
      today,
    );
    expect(items.map((i) => [i.itemType, i.id, i.daysOver])).toEqual([
      ['ingredient', 'b', 5],
      ['product', 'p', 2],
      ['ingredient', 'a', 1],
    ]);
  });
});

describe('extendedExpiry', () => {
  it('counts from today, not from the old date', () => {
    expect(extendedExpiry(today, 3)).toBe('2026-10-13');
  });
});
