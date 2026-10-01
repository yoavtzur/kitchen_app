import { describe, expect, it } from 'vitest';
import { newWasteEntry, periodRange, shiftPeriod, sortedWasteLog, summarizeWaste } from '../waste';
import type { WasteEntry } from '../../types';

const entry = (over: Partial<WasteEntry>): WasteEntry => ({
  id: 'w',
  date: '2026-10-10',
  at: '2026-10-10T08:00:00.000Z',
  itemType: 'ingredient',
  itemId: 'tomato',
  itemName: 'עגבניות',
  unit: 'kg',
  qty: 1,
  reason: 'expired',
  ...over,
});

describe('periodRange', () => {
  it('returns the week by the kitchen first weekday', () => {
    // 2026-10-10 is a Saturday.
    expect(periodRange('week', '2026-10-10', 0)).toEqual({ from: '2026-10-04', to: '2026-10-10' });
    expect(periodRange('week', '2026-10-10', 1)).toEqual({ from: '2026-10-05', to: '2026-10-11' });
  });

  it('returns the calendar month, including a short February', () => {
    expect(periodRange('month', '2026-10-10', 0)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(periodRange('month', '2026-02-15', 0)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
});

describe('shiftPeriod', () => {
  it('moves a week by seven days and a month across a year boundary', () => {
    expect(shiftPeriod('week', '2026-10-10', -1)).toBe('2026-10-03');
    expect(shiftPeriod('month', '2026-01-20', -1)).toBe('2025-12-01');
    expect(shiftPeriod('month', '2026-12-20', 1)).toBe('2027-01-01');
  });
});

describe('summarizeWaste', () => {
  it('totals per item inside the range, most first', () => {
    const rows = summarizeWaste(
      [
        entry({ id: '1', qty: 1.5 }),
        entry({ id: '2', qty: 0.5, date: '2026-10-08' }),
        entry({ id: '3', itemId: 'milk', itemName: 'חלב', unit: 'l', qty: 4 }),
        entry({ id: '4', date: '2026-09-30', qty: 99 }), // outside the range
      ],
      { from: '2026-10-04', to: '2026-10-10' },
    );
    expect(rows.map((r) => [r.itemId, r.totalQty, r.count])).toEqual([
      ['milk', 4, 1],
      ['tomato', 2, 2],
    ]);
  });

  it('shows the name from the latest entry for an item that was renamed', () => {
    const rows = summarizeWaste(
      [
        entry({ id: '1', itemName: 'עגבנייה' }),
        entry({ id: '2', itemName: 'עגבניות שרי' }),
      ],
      { from: '2026-10-04', to: '2026-10-10' },
    );
    expect(rows[0].name).toBe('עגבניות שרי');
  });
});

describe('sortedWasteLog', () => {
  it('orders newest first by timestamp', () => {
    const log = [
      entry({ id: 'old', at: '2026-10-01T08:00:00.000Z' }),
      entry({ id: 'new', at: '2026-10-09T08:00:00.000Z' }),
    ];
    expect(sortedWasteLog({ wasteLog: log }).map((e) => e.id)).toEqual(['new', 'old']);
    expect(sortedWasteLog({}).length).toBe(0);
  });
});

describe('newWasteEntry', () => {
  it('omits optional fields rather than carrying undefined, so a JSON round trip is identical', () => {
    const e = newWasteEntry({
      today: '2026-10-10',
      itemType: 'ingredient',
      itemId: 'tomato',
      itemName: 'עגבניות',
      unit: 'kg',
      qty: 1,
      reason: 'spoiled',
    });
    expect(JSON.parse(JSON.stringify(e))).toEqual(e);
    expect('cookId' in e).toBe(false);
    expect('expiredOn' in e).toBe(false);
  });
});
