import { describe, expect, it } from 'vitest';
import { reducer } from '../../store/reducer';
import { applyRestore, diffForRestore } from '../restore';
import { autoTaskId } from '../tasks';
import type { AppState } from '../../types';

// A small kitchen where one recipe feeds a product with a task, a plan entry and an override, and
// one ingredient appears in two recipes plus an order line — so a single delete touches many
// collections, which is exactly what the undo has to put back.
const state: AppState = {
  schemaVersion: 5,
  settings: { defaultCoverageDays: 1, weekStartsOn: 0, roundMultiplierTo: null },
  cooks: [
    { id: 'cook-1', name: 'דני', color: '#111' },
    { id: 'cook-2', name: 'מאיה', color: '#222' },
  ],
  stations: [{ id: 'st-hot', name: 'חם', createdAt: '2026-10-01' }],
  ingredients: [
    { id: 'ing-egg', name: 'ביצים', unit: 'unit', currentQty: 60, dailyUsage: 20, weeklyUsage: 140 },
    { id: 'ing-milk', name: 'חלב', unit: 'l', currentQty: 5, dailyUsage: 2, weeklyUsage: 14 },
  ],
  products: [
    { id: 'prod-cb', name: 'קרם ברולה', kind: 'menu', unit: 'unit', currentQty: 3, weeklyTarget: 40, dailyUsage: 15, recipeId: 'rec-cb' },
  ],
  recipes: [
    {
      id: 'rec-cb',
      name: 'קרם ברולה',
      category: 'st-hot',
      yieldQty: 8,
      yieldUnit: 'unit',
      producesProductId: 'prod-cb',
      items: [
        { refType: 'ingredient', refId: 'ing-egg', qty: 4, unit: 'unit' },
        { refType: 'ingredient', refId: 'ing-milk', qty: 1, unit: 'l' },
      ],
      steps: ['לערבב'],
    },
    {
      id: 'rec-omelet',
      name: 'חביתה',
      category: 'general',
      yieldQty: 1,
      yieldUnit: 'unit',
      items: [{ refType: 'ingredient', refId: 'ing-egg', qty: 2, unit: 'unit' }],
      steps: [],
    },
  ],
  tasks: [
    { id: 'task-1', date: '2026-10-01', recipeId: 'rec-omelet', multiplier: 1, priority: 'yellow', done: false, source: 'manual' },
  ],
  taskOverrides: [{ id: autoTaskId('prod-cb', '2026-10-01'), productId: 'prod-cb', date: '2026-10-01', done: false }],
  specialEvents: [],
  dayPlans: [{ date: '2026-10-01', entries: [{ productId: 'prod-cb', prepOverride: 12 }] }],
  orderLines: [{ ingredientId: 'ing-egg', date: '2026-10-01', qtyOverride: 30, ordered: true }],
};

describe('diffForRestore / applyRestore', () => {
  it('captures only what the deletion actually changed', () => {
    const after = reducer(state, { type: 'DELETE_COOK', id: 'cook-1' });
    expect(diffForRestore(state, after)).toEqual({ cooks: [state.cooks[0]] });
  });

  it('is empty when nothing changed', () => {
    expect(diffForRestore(state, state)).toEqual({});
  });

  it.each([
    ['a cook', { type: 'DELETE_COOK', id: 'cook-1' } as const],
    ['an ingredient used by recipes and an order', { type: 'DELETE_INGREDIENT', id: 'ing-egg' } as const],
    ['a recipe with a product, task override and plan entry', { type: 'DELETE_RECIPE', id: 'rec-cb' } as const],
    ['a station that recipes point at', { type: 'DELETE_STATION', id: 'st-hot', moveToId: 'general' } as const],
  ])('deleting %s and restoring gives back the original kitchen', (_label, action) => {
    const after = reducer(state, action);
    expect(after).not.toEqual(state);
    const restored = applyRestore(after, diffForRestore(state, after));
    // Order within a collection may differ (restored items are appended), so compare as sets.
    const sorted = (s: AppState) => JSON.parse(JSON.stringify(s, (_k, v) => (Array.isArray(v) ? [...v].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : v)));
    expect(sorted(restored)).toEqual(sorted(state));
  });

  it('puts a recipe back where it was, not at the end', () => {
    const after = reducer(state, { type: 'DELETE_INGREDIENT', id: 'ing-milk' });
    const restored = applyRestore(after, diffForRestore(state, after));
    expect(restored.recipes.map((r) => r.id)).toEqual(['rec-cb', 'rec-omelet']);
    expect(restored.recipes[0].items).toHaveLength(2);
  });

  it('is idempotent: restoring twice equals restoring once', () => {
    const after = reducer(state, { type: 'DELETE_RECIPE', id: 'rec-cb' });
    const restore = diffForRestore(state, after);
    const once = applyRestore(after, restore);
    expect(applyRestore(once, restore)).toEqual(once);
  });

  it('survives the JSON round trip an op takes between devices', () => {
    const after = reducer(state, { type: 'DELETE_RECIPE', id: 'rec-cb' });
    const restore = JSON.parse(JSON.stringify(diffForRestore(state, after)));
    expect(reducer(after, { type: 'RESTORE_ENTITIES', restore })).toEqual(
      reducer(after, { type: 'RESTORE_ENTITIES', restore: diffForRestore(state, after) }),
    );
  });
});
