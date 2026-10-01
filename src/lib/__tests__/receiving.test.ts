import { describe, expect, it } from 'vitest';
import { bySupplier, fullyReceived, NO_SUPPLIER, orderedLines, stillOwed } from '../receiving';
import { movedTooFar } from '../useLongPress';
import { reducer } from '../../store/reducer';
import type { AppState, Ingredient, OrderLine } from '../../types';

const today = '2026-10-10';
const ing = (id: string, name: string, supplier?: string): Ingredient => ({
  id, name, unit: 'kg', currentQty: 2, dailyUsage: 1, weeklyUsage: 7, supplier,
});
const line = (ingredientId: string, date: string, qtyOverride: number, extra: Partial<OrderLine> = {}): OrderLine => ({
  ingredientId, date, qtyOverride, ordered: true, ...extra,
});
const state = (orderLines: OrderLine[], ingredients = [ing('flour', 'קמח', 'מילה'), ing('milk', 'חלב', 'תנובה'), ing('salt', 'מלח')]): AppState => ({
  schemaVersion: 5,
  settings: { defaultCoverageDays: 1, weekStartsOn: 0, roundMultiplierTo: null },
  cooks: [], stations: [], ingredients, products: [], recipes: [], tasks: [], taskOverrides: [], specialEvents: [], dayPlans: [], orderLines,
});

describe('orderedLines', () => {
  it('lists only lines that went out, with a quantity, inside the window', () => {
    const s = state([
      line('flour', today, 10),
      line('milk', '2026-10-04', 5), // 6 days back: still inside
      line('salt', '2026-10-03', 5), // 7 days back: outside
      { ingredientId: 'flour', date: '2026-10-09', ordered: false, qtyOverride: 3 },
      line('milk', '2026-10-08', 0),
    ]);
    expect(orderedLines(s, today).map((l) => `${l.ingredient.id}@${l.date}`).sort()).toEqual(['flour@2026-10-10', 'milk@2026-10-04']);
  });

  it('computes what is still owed and never goes negative', () => {
    const [partial, over] = orderedLines(state([line('flour', today, 10, { receivedQty: 4 }), line('milk', today, 5, { receivedQty: 8 })]), today);
    expect(partial).toMatchObject({ ordered: 10, received: 4, remaining: 6 });
    expect(over.remaining).toBe(0);
  });

  it('splits the still-owed from the finished', () => {
    const lines = orderedLines(state([line('flour', today, 10, { receivedQty: 10 }), line('milk', today, 5)]), today);
    expect(stillOwed(lines).map((l) => l.ingredient.id)).toEqual(['milk']);
    expect(fullyReceived(lines).map((l) => l.ingredient.id)).toEqual(['flour']);
  });
});

describe('bySupplier', () => {
  it('orders suppliers alphabetically with "no supplier" last', () => {
    const lines = orderedLines(state([line('salt', today, 1), line('milk', today, 1), line('flour', today, 1)]), today);
    expect(bySupplier(lines).map((g) => g.supplier)).toEqual(['מילה', 'תנובה', NO_SUPPLIER]);
  });
});

describe('SET_LINE_RECEIVED', () => {
  const base = state([line('flour', today, 10)]);
  const recv = (s: AppState, receivedQty: number) => reducer(s, { type: 'SET_LINE_RECEIVED', ingredientId: 'flour', date: today, receivedQty });

  it('adds the difference to stock and records it on the line, keeping the line', () => {
    const next = recv(base, 10);
    expect(next.ingredients.find((i) => i.id === 'flour')!.currentQty).toBe(12);
    expect(next.orderLines).toHaveLength(1);
    expect(next.orderLines[0].receivedQty).toBe(10);
  });

  it('is idempotent: the same receipt twice adds stock once', () => {
    const once = recv(base, 10);
    expect(recv(once, 10)).toBe(once);
  });

  it('handles a short delivery and then the rest', () => {
    const partial = recv(base, 6);
    expect(partial.ingredients[0].currentQty).toBe(8);
    const rest = recv(partial, 10);
    expect(rest.ingredients[0].currentQty).toBe(12);
  });

  it('is undone exactly by setting the previous number back', () => {
    const received = recv(base, 10);
    const undone = recv(received, 0);
    expect(undone.ingredients[0].currentQty).toBe(2);
    expect('receivedQty' in undone.orderLines[0]).toBe(false);
  });

  it('ignores a line that was never ordered or does not exist', () => {
    const notOrdered = state([{ ingredientId: 'flour', date: today, ordered: false, qtyOverride: 10 }]);
    expect(recv(notOrdered, 5)).toBe(notOrdered);
    expect(reducer(base, { type: 'SET_LINE_RECEIVED', ingredientId: 'milk', date: today, receivedQty: 5 })).toBe(base);
  });

  it('survives the JSON round trip an op takes', () => {
    const action = { type: 'SET_LINE_RECEIVED', ingredientId: 'flour', date: today, receivedQty: 7 } as const;
    expect(reducer(base, JSON.parse(JSON.stringify(action)))).toEqual(reducer(base, action));
  });
});

describe('movedTooFar', () => {
  it('tolerates a drifting thumb but not a scroll', () => {
    expect(movedTooFar(3, 4)).toBe(false);
    expect(movedTooFar(0, 30)).toBe(true);
  });
});
