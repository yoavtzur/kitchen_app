import { describe, expect, it } from 'vitest';
import { parseImportedState } from '../storage';
import { getDisplayTasks } from '../../lib/tasks';
import { todayStr } from '../../lib/date';

/**
 * parseImportedState runs the same migration chain as loadState, so it exercises the v3
 * upgrade without needing a localStorage stub — and it is a real user path (importing an
 * older backup). The bug being repaired here is the one that started this work: the old
 * recipe editor only ever wrote Recipe.producesProductId, never Product.recipeId.
 */
function v2Json(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 2,
    settings: { defaultCoverageDays: 1, weekStartsOn: 0, roundMultiplierTo: 0.25 },
    cooks: [],
    ingredients: [
      { id: 'ing-zucchini', name: 'קישואים', unit: 'kg', currentQty: 3, dailyUsage: 1, weeklyUsage: 7 },
    ],
    products: [
      {
        id: 'prod-cream',
        name: 'קרם זוקיני',
        kind: 'component',
        unit: 'l',
        currentQty: 0,
        weeklyTarget: 14,
        dailyUsage: 2,
        // deliberately missing recipeId — this is what the old editor left behind
      },
    ],
    recipes: [
      {
        id: 'recipe-cream',
        name: 'קרם זוקיני',
        category: 'cold',
        yieldQty: 1,
        yieldUnit: 'unit', // disagrees with the product's litres
        producesProductId: 'prod-cream',
        items: [{ refType: 'ingredient', refId: 'ing-zucchini', qty: 1.5, unit: 'kg' }],
        steps: [],
      },
    ],
    tasks: [],
    taskOverrides: [],
    specialEvents: [],
    dayPlans: [],
    ...overrides,
  });
}

describe('migrating v2 data to v3', () => {
  it('repairs a one-sided link so the recipe finally drives the main screen', () => {
    const state = parseImportedState(v2Json());

    expect(state.schemaVersion).toBe(5);
    expect(state.products[0].recipeId).toBe('recipe-cream');
    expect(state.recipes[0].producesProductId).toBe('prod-cream');
    // The old preset's 'cold' category becomes a real, correctly labeled station.
    expect(state.stations).toEqual([{ id: 'cold', name: 'פס קר', createdAt: expect.any(String) }]);

    // The whole point: this state previously produced no task at all.
    const tasks = getDisplayTasks(todayStr(), state);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ productId: 'prod-cream', multiplier: 2 });
  });

  it('aligns the recipe yield unit to the product stock unit', () => {
    const state = parseImportedState(v2Json());
    expect(state.recipes[0].yieldUnit).toBe('l');
  });

  it('fills the link in from the product side too', () => {
    const json = JSON.parse(v2Json());
    json.products[0].recipeId = 'recipe-cream';
    json.recipes[0].producesProductId = undefined;
    const state = parseImportedState(JSON.stringify(json));

    expect(state.recipes[0].producesProductId).toBe('prod-cream');
    expect(state.products[0].recipeId).toBe('recipe-cream');
  });

  it('adds an empty order sheet', () => {
    expect(parseImportedState(v2Json()).orderLines).toEqual([]);
  });

  it('prunes references left behind by deletes that never cascaded', () => {
    const json = JSON.parse(v2Json());
    json.recipes[0].items.push({ refType: 'ingredient', refId: 'ing-gone', qty: 1, unit: 'kg' });
    json.dayPlans = [{ date: '2026-09-05', entries: [{ productId: 'prod-gone', prepOverride: 5 }] }];
    json.taskOverrides = [{ id: 'auto-prod-gone-2026-09-05', productId: 'prod-gone', date: '2026-09-05' }];
    json.specialEvents = [
      { id: 'ev-1', name: 'אירוע', date: '2026-09-06', extras: [{ productId: 'prod-gone', extraQty: 3 }] },
    ];
    json.tasks = [
      { id: 't-1', date: '2026-09-05', recipeId: 'recipe-gone', multiplier: 1, priority: 'red', done: false, source: 'manual' },
    ];

    const state = parseImportedState(JSON.stringify(json));

    expect(state.recipes[0].items.map((i) => i.refId)).toEqual(['ing-zucchini']);
    expect(state.dayPlans).toEqual([]);
    expect(state.taskOverrides).toEqual([]);
    expect(state.specialEvents).toEqual([]);
    expect(state.tasks).toEqual([]);
  });

  it('drops a link that points at an entity which no longer exists', () => {
    const json = JSON.parse(v2Json());
    json.recipes[0].producesProductId = 'prod-gone';
    json.products[0].recipeId = 'recipe-gone';
    const state = parseImportedState(JSON.stringify(json));

    expect(state.products[0].recipeId).toBeUndefined();
    expect(state.recipes[0].producesProductId).toBeUndefined();
  });

  it('keeps the user data when chaining a v1 backup all the way to v3', () => {
    const json = JSON.parse(v2Json());
    json.schemaVersion = 1;
    // v1 stored frozen auto tasks; only the manual ones should survive
    json.tasks = [
      { id: 't-auto', date: '2026-09-05', recipeId: 'recipe-cream', multiplier: 1, priority: 'red', done: false, source: 'auto' },
      { id: 't-manual', date: '2026-09-05', recipeId: 'recipe-cream', multiplier: 1, priority: 'red', done: false, source: 'manual' },
    ];

    const state = parseImportedState(JSON.stringify(json));

    expect(state.schemaVersion).toBe(5);
    expect(state.ingredients).toHaveLength(1);
    expect(state.recipes).toHaveLength(1);
    expect(state.products[0].recipeId).toBe('recipe-cream');
    expect(state.tasks.map((t) => t.id)).toEqual(['t-manual']);
  });
});

describe('migrating v3 data to v4', () => {
  function v3Json(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      schemaVersion: 3,
      settings: { defaultCoverageDays: 1, weekStartsOn: 0, roundMultiplierTo: 0.25 },
      cooks: [],
      ingredients: [
        { id: 'ing-egg', name: 'ביצים', unit: 'unit', currentQty: 60, dailyUsage: 20, weeklyUsage: 140 },
      ],
      products: [],
      recipes: [],
      tasks: [],
      taskOverrides: [],
      specialEvents: [],
      dayPlans: [],
      orderLines: [{ ingredientId: 'ing-egg', qtyOverride: 30, ordered: true }],
      ...overrides,
    });
  }

  it('stamps every pre-existing order line with today so the in-progress sheet survives', () => {
    const state = parseImportedState(v3Json());
    expect(state.schemaVersion).toBe(5);
    expect(state.orderLines).toEqual([
      { ingredientId: 'ing-egg', date: todayStr(), qtyOverride: 30, ordered: true },
    ]);
  });

  it('an already-empty order sheet stays empty', () => {
    const state = parseImportedState(v3Json({ orderLines: [] }));
    expect(state.orderLines).toEqual([]);
  });
});

describe('migrating v4 data to v5', () => {
  function v4Json(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      schemaVersion: 4,
      settings: { defaultCoverageDays: 1, weekStartsOn: 0, roundMultiplierTo: 0.25 },
      cooks: [],
      ingredients: [],
      products: [],
      recipes: [
        { id: 'recipe-1', name: 'א', category: 'hot', yieldQty: 1, yieldUnit: 'unit', items: [], steps: [] },
        { id: 'recipe-2', name: 'ב', category: 'hot', yieldQty: 1, yieldUnit: 'unit', items: [], steps: [] },
        { id: 'recipe-3', name: 'ג', category: 'general', yieldQty: 1, yieldUnit: 'unit', items: [], steps: [] },
      ],
      tasks: [
        { id: 't-1', date: '2026-09-05', title: 'ד', categoryOverride: 'taboon', multiplier: 1, priority: 'red', done: false, source: 'manual' },
      ],
      taskOverrides: [],
      specialEvents: [],
      dayPlans: [],
      orderLines: [],
      ...overrides,
    });
  }

  it('backs the categories actually in use with real, deduplicated stations — but never "general"', () => {
    const state = parseImportedState(v4Json());
    expect(state.schemaVersion).toBe(5);
    expect(state.stations).toEqual(
      expect.arrayContaining([
        { id: 'hot', name: 'פס חם', createdAt: expect.any(String) },
        { id: 'taboon', name: 'טאבון', createdAt: expect.any(String) },
      ]),
    );
    expect(state.stations).toHaveLength(2);
  });

  it('a kitchen with nothing but general-category data gets an empty station list', () => {
    const state = parseImportedState(v4Json({ recipes: [], tasks: [] }));
    expect(state.stations).toEqual([]);
  });
});
