import { describe, expect, it } from 'vitest';
import {
  batchExpiry,
  expiredItems,
  expiryForBatch,
  expiryStatus,
  extendedExpiry,
  remainingExpiry,
  soonItems,
  validShelfLife,
} from '../expiry';
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

describe('shelf life of a prepared batch', () => {
  it('counts from the day it is made: 4 days from the 10th is good through the 14th', () => {
    expect(expiryForBatch('2026-10-10', 4)).toBe('2026-10-14');
    expect(expiryForBatch('2026-10-10', 0)).toBe('2026-10-10');
  });

  it('crosses a month end', () => {
    expect(expiryForBatch('2026-10-30', 3)).toBe('2026-11-02');
  });

  it('accepts only whole, sane day counts', () => {
    expect(validShelfLife(0)).toBe(0);
    expect(validShelfLife(4)).toBe(4);
    expect(validShelfLife(undefined)).toBeUndefined();
    expect(validShelfLife(-1)).toBeUndefined();
    expect(validShelfLife(2.5)).toBeUndefined();
    expect(validShelfLife(NaN)).toBeUndefined();
    expect(validShelfLife('4')).toBeUndefined();
    expect(validShelfLife(9999)).toBeUndefined();
  });
});

describe('batchExpiry: the earliest date on the shelf wins', () => {
  it('sets the batch date when the shelf is empty', () => {
    expect(batchExpiry({ currentQty: 0 }, '2026-10-14')).toEqual({
      before: {},
      after: { expiresOn: '2026-10-14', lastBatchExpiresOn: '2026-10-14' },
    });
  });

  it('ignores a stale date left on a product with no stock', () => {
    const change = batchExpiry({ currentQty: 0, expiresOn: '2026-09-01' }, '2026-10-14');
    expect(change.after.expiresOn).toBe('2026-10-14');
    expect(change.before).toEqual({ expiresOn: '2026-09-01' });
  });

  it('keeps an earlier date already on the shelf and remembers the new batch separately', () => {
    const change = batchExpiry({ currentQty: 3, expiresOn: '2026-10-12', lastBatchExpiresOn: '2026-10-12' }, '2026-10-14');
    expect(change.after).toEqual({ expiresOn: '2026-10-12', lastBatchExpiresOn: '2026-10-14' });
  });

  it('moves to the new date when the stock on the shelf was good for longer', () => {
    const change = batchExpiry({ currentQty: 3, expiresOn: '2026-10-20' }, '2026-10-14');
    expect(change.after.expiresOn).toBe('2026-10-14');
  });

  it('takes the new date when stock exists but carries none', () => {
    expect(batchExpiry({ currentQty: 3 }, '2026-10-14').after.expiresOn).toBe('2026-10-14');
  });

  it('does not move the remembered last batch backwards', () => {
    const change = batchExpiry({ currentQty: 3, expiresOn: '2026-10-12', lastBatchExpiresOn: '2026-10-18' }, '2026-10-14');
    expect(change.after.lastBatchExpiresOn).toBe('2026-10-18');
  });
});

describe('remainingExpiry: what is left good after the old batch is thrown', () => {
  it('suggests the last batch when it is later than the flagged date and not yet over', () => {
    expect(remainingExpiry({ lastBatchExpiresOn: '2026-10-14' }, '2026-10-09', today)).toBe('2026-10-14');
  });

  it('suggests nothing when the last batch is the flagged one, or is itself over, or unknown', () => {
    expect(remainingExpiry({ lastBatchExpiresOn: '2026-10-09' }, '2026-10-09', today)).toBeUndefined();
    expect(remainingExpiry({ lastBatchExpiresOn: '2026-10-08' }, '2026-10-07', today)).toBeUndefined();
    expect(remainingExpiry({}, '2026-10-09', today)).toBeUndefined();
  });
});

describe('soonItems: due today or tomorrow, still in stock', () => {
  it('lists those, soonest first, and skips used-up, fine and expired ones', () => {
    const s = state({
      ingredients: [
        ing('milk', { expiresOn: '2026-10-11' }),
        ing('gone', { expiresOn: '2026-10-11', currentQty: 0 }),
        ing('later', { expiresOn: '2026-10-20' }),
        ing('old', { expiresOn: '2026-10-09' }),
      ],
      products: [
        {
          id: 'sauce',
          name: 'sauce',
          kind: 'component',
          unit: 'kg',
          currentQty: 1,
          weeklyTarget: 0,
          dailyUsage: 0,
          expiresOn: today,
        },
      ],
    });
    expect(soonItems(s, today).map((i) => [i.id, i.daysLeft])).toEqual([
      ['sauce', 0],
      ['milk', 1],
    ]);
  });
});
