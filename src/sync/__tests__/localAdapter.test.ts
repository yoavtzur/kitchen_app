import { describe, expect, it } from 'vitest';
import { createLocalAdapter } from '../localAdapter';
import type { AppState } from '../../types';

function baseState(overrides: Partial<AppState> = {}): AppState {
  return {
    schemaVersion: 3,
    settings: { defaultCoverageDays: 1, weekStartsOn: 0, roundMultiplierTo: 0.25 },
    cooks: [],
    ingredients: [{ id: 'ing-egg', name: 'ביצים', unit: 'unit', currentQty: 10, dailyUsage: 20, weeklyUsage: 140 }],
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

describe('createLocalAdapter', () => {
  it('bootstrap returns the seed with seq 0 and no ops', async () => {
    const seed = baseState();
    const adapter = createLocalAdapter(seed);
    expect(await adapter.bootstrap()).toEqual({ confirmed: seed, confirmedSeq: 0, ops: [], schemaVersion: 3 });
  });

  it('appendOps assigns increasing seqs and applies the reducer itself', async () => {
    const adapter = createLocalAdapter(baseState());
    const rows = await adapter.appendOps([{ opId: 'op-1', action: { type: 'SET_INGREDIENT_QTY', id: 'ing-egg', qty: 5 } }]);
    expect(rows).toEqual([{ seq: 1, opId: 'op-1', action: { type: 'SET_INGREDIENT_QTY', id: 'ing-egg', qty: 5 } }]);
    const next = await adapter.bootstrap();
    expect(next.confirmedSeq).toBe(1);
    expect(next.confirmed.ingredients[0].currentQty).toBe(5);
  });

  it('seq numbers keep increasing across multiple appendOps calls', async () => {
    const adapter = createLocalAdapter(baseState());
    await adapter.appendOps([{ opId: 'op-1', action: { type: 'SET_INGREDIENT_PAR', id: 'ing-egg', parLevel: 1 } }]);
    const rows2 = await adapter.appendOps([{ opId: 'op-2', action: { type: 'SET_INGREDIENT_PAR', id: 'ing-egg', parLevel: 2 } }]);
    expect(rows2[0].seq).toBe(2);
  });

  it('fetchOpsSince and subscribe are no-ops (single local tab)', async () => {
    const adapter = createLocalAdapter(baseState());
    expect(await adapter.fetchOpsSince(0)).toEqual([]);
    const unsubscribe = adapter.subscribe(
      () => {},
      () => {},
    );
    expect(() => unsubscribe()).not.toThrow();
  });
});
