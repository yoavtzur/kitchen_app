import { describe, expect, it } from 'vitest';
import {
  buildOrderLines,
  collectCountChanges,
  effectiveCount,
  groupBySupplier,
  lowStockTone,
  parseQty,
  planFillToPar,
  suggestedQty,
  supplierMessages,
} from '../orders';
import type { AppState, Ingredient, OrderLine } from '../../types';

const date = '2026-09-05'; // a Saturday; dailyUsage below has no weekday overrides, so the day is irrelevant

const egg: Ingredient = { id: 'egg', name: 'ביצים', unit: 'unit', currentQty: 60, dailyUsage: 20, weeklyUsage: 140 };
const flour: Ingredient = { id: 'flour', name: 'קמח', unit: 'kg', currentQty: 10, dailyUsage: 1, weeklyUsage: 7 };
const salt: Ingredient = { id: 'salt', name: 'מלח', unit: 'kg', currentQty: 5, dailyUsage: 0, weeklyUsage: 0 };

function stateWith(ingredients: Ingredient[], orderLines: OrderLine[] = []): AppState {
  return {
    schemaVersion: 5,
    settings: { defaultCoverageDays: 1, weekStartsOn: 0, roundMultiplierTo: 0.25 },
    cooks: [],
    stations: [],
    ingredients,
    products: [],
    recipes: [],
    tasks: [],
    taskOverrides: [],
    specialEvents: [],
    dayPlans: [],
    orderLines,
  };
}

describe('parseQty', () => {
  it('accepts a number and rejects empty, half-typed and negative input', () => {
    expect(parseQty('12.5')).toBe(12.5);
    expect(parseQty('0')).toBe(0);
    expect(parseQty('')).toBeUndefined();
    expect(parseQty('-')).toBeUndefined();
    expect(parseQty('-3')).toBeUndefined();
    expect(parseQty(undefined)).toBeUndefined();
  });
});

describe('effectiveCount / collectCountChanges', () => {
  it('falls back to the stored count when nothing usable is typed', () => {
    expect(effectiveCount(egg, {})).toBe(60);
    expect(effectiveCount(egg, { egg: '' })).toBe(60);
    expect(effectiveCount(egg, { egg: '25' })).toBe(25);
  });

  it('reports only counts that differ from the stored value', () => {
    expect(collectCountChanges([egg, flour], { egg: '60', flour: '4' })).toEqual([{ id: 'flour', qty: 4 }]);
    expect(collectCountChanges([egg], {})).toEqual([]);
  });
});

describe('suggestedQty', () => {
  it('tops the shelf up to the weekly need', () => {
    expect(suggestedQty(egg, stateWith([egg]), date, {})).toBe(80);
  });

  it('recomputes against a typed count, so counting the shelf changes the order beside it', () => {
    expect(suggestedQty(egg, stateWith([egg]), date, { egg: '100' })).toBe(40);
  });

  it('prefers the chef’s own number over any suggestion', () => {
    const state = stateWith([egg], [{ ingredientId: 'egg', date, qtyOverride: 7, ordered: false }]);
    expect(suggestedQty(egg, state, date, { egg: '100' })).toBe(7);
  });

  it('ignores an override from another day', () => {
    const state = stateWith([egg], [{ ingredientId: 'egg', date: '2026-09-04', qtyOverride: 7, ordered: false }]);
    expect(suggestedQty(egg, state, date, {})).toBe(80);
  });

  it('is never negative', () => {
    expect(suggestedQty(egg, stateWith([egg]), date, { egg: '500' })).toBe(0);
  });
});

describe('buildOrderLines', () => {
  it('is non-empty with no edits at all — the zero-touch case the approve button depends on', () => {
    const lines = buildOrderLines(stateWith([egg, flour]), {}, date);
    expect(lines).toEqual([{ ingredientId: 'egg', qty: 80 }]);
  });

  it('drops ingredients that need nothing', () => {
    const lines = buildOrderLines(stateWith([egg, flour, salt]), {}, date);
    expect(lines.map((l) => l.ingredientId)).toEqual(['egg']);
  });

  it('is empty only when there is genuinely nothing to order', () => {
    expect(buildOrderLines(stateWith([flour, salt]), {}, date)).toEqual([]);
  });

  it('follows typed counts', () => {
    const lines = buildOrderLines(stateWith([egg, flour]), { egg: '500', flour: '0' }, date);
    expect(lines).toEqual([{ ingredientId: 'flour', qty: 7 }]);
  });
});

describe('lowStockTone', () => {
  it('flags under a day red and under three days yellow', () => {
    expect(lowStockTone(egg, 10, date)).toBe('red');
    expect(lowStockTone(egg, 40, date)).toBe('yellow');
  });

  it('flags nothing when there is plenty, or when usage is unknown', () => {
    expect(lowStockTone(egg, 100, date)).toBeNull();
    expect(lowStockTone(salt, 0, date)).toBeNull();
  });
});

describe('planFillToPar', () => {
  it('lists hand-typed quantities for the day, with their previous values for undo', () => {
    const state = stateWith(
      [egg, flour],
      [
        { ingredientId: 'egg', date, qtyOverride: 7, ordered: false },
        { ingredientId: 'flour', date, ordered: false },
      ],
    );
    expect(planFillToPar(state, date)).toEqual([{ ingredientId: 'egg', previous: 7 }]);
  });

  it('leaves lines that were already ordered alone — that quantity is what went to the supplier', () => {
    const state = stateWith([egg], [{ ingredientId: 'egg', date, qtyOverride: 7, ordered: true }]);
    expect(planFillToPar(state, date)).toEqual([]);
  });

  it('ignores other days', () => {
    const state = stateWith([egg], [{ ingredientId: 'egg', date: '2026-09-04', qtyOverride: 7, ordered: false }]);
    expect(planFillToPar(state, date)).toEqual([]);
  });
});

describe('an ingredient flagged short', () => {
  const flagged: Ingredient = { ...salt, shortFlag: true, parLevel: 4 };

  it('is ordered at its par level even when the numbers see no need', () => {
    expect(suggestedQty(salt, stateWith([salt]), date, {})).toBe(0);
    expect(suggestedQty(flagged, stateWith([flagged]), date, {})).toBe(4);
  });

  it('falls back to a day of cover, then to one, when there is no par level', () => {
    const daily = { ...flagged, parLevel: undefined, dailyUsage: 3 };
    expect(suggestedQty(daily, stateWith([daily]), date, {})).toBe(3);
    const none = { ...flagged, parLevel: undefined, dailyUsage: 0 };
    expect(suggestedQty(none, stateWith([none]), date, {})).toBe(1);
  });

  it('does not override a quantity the chef typed', () => {
    const state = stateWith([flagged], [{ ingredientId: 'salt', date, qtyOverride: 2, ordered: false }]);
    expect(suggestedQty(flagged, state, date, {})).toBe(2);
  });

  it('is answered by a typed count above the stored one', () => {
    expect(suggestedQty(flagged, stateWith([flagged]), date, { salt: '9' })).toBe(0);
  });

  it('shows a red dot, and puts the ingredient in the order', () => {
    expect(lowStockTone(flagged, flagged.currentQty, date)).toBe('red');
    expect(buildOrderLines(stateWith([flagged]), {}, date)).toEqual([{ ingredientId: 'salt', qty: 4 }]);
  });
});

describe('supplierMessages', () => {
  const dairy: Ingredient = { ...flour, id: 'milk', name: 'חלב', unit: 'l', supplier: 'תנובה' };
  const mill: Ingredient = { ...flour, supplier: 'מילה' };
  const loose: Ingredient = { ...salt };

  it('splits one message per supplier, alphabetically, with no-supplier last', () => {
    const lines = [
      { ingredientId: 'salt', qty: 1 },
      { ingredientId: 'milk', qty: 12 },
      { ingredientId: 'flour', qty: 5 },
    ];
    const out = supplierMessages(lines, [mill, dairy, loose]);
    expect(out.map((m) => m.supplier)).toEqual(['מילה', 'תנובה', 'ללא ספק']);
    expect(out[1]).toEqual({ supplier: 'תנובה', count: 1, text: '*תנובה*\n• חלב: 12 ליטר' });
  });

  it('puts several items of one supplier in one message and drops empty quantities', () => {
    const second: Ingredient = { ...mill, id: 'rye', name: 'שיפון' };
    const out = supplierMessages(
      [{ ingredientId: 'flour', qty: 5 }, { ingredientId: 'rye', qty: 2 }, { ingredientId: 'salt', qty: 0 }],
      [mill, second, loose],
    );
    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(2);
    expect(out[0].text.split('\n')).toHaveLength(3);
  });

  it('is empty for an empty order', () => {
    expect(supplierMessages([], [mill])).toEqual([]);
  });
});

describe('groupBySupplier', () => {
  it('keeps each ingredient under its supplier in the same order as the messages', () => {
    const a: Ingredient = { ...flour, supplier: 'תנובה' };
    const groups = groupBySupplier([salt, a, { ...egg, supplier: 'תנובה' }]);
    expect(groups.map((g) => [g.supplier, g.ingredients.length])).toEqual([['תנובה', 2], ['ללא ספק', 1]]);
  });
});
