import { describe, expect, it } from 'vitest';
import {
  autoTaskId,
  blockedIngredients,
  getDisplayTasks,
  groupByStation,
  sortDisplayTasks,
  taskProgress,
  type DisplayTask,
} from '../tasks';
import type { AppState, Ingredient, Product, Recipe } from '../../types';

function baseState(overrides: Partial<AppState> = {}): AppState {
  return {
    schemaVersion: 2,
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

const cremeBrulee: Product = {
  id: 'prod-creme-brulee',
  name: 'קרם ברולה',
  kind: 'menu',
  unit: 'unit',
  currentQty: 3,
  weeklyTarget: 40,
  dailyUsage: 15,
  recipeId: 'recipe-creme-brulee',
};

const cremeBruleeRecipe: Recipe = {
  id: 'recipe-creme-brulee',
  name: 'קרם ברולה',
  category: 'dessert',
  yieldQty: 8,
  yieldUnit: 'unit',
  producesProductId: 'prod-creme-brulee',
  items: [],
  steps: [],
};

const date = '2026-09-05';

describe('getDisplayTasks — auto tasks', () => {
  it('shows a live auto task when the product needs prep', () => {
    const state = baseState({ products: [cremeBrulee], recipes: [cremeBruleeRecipe] });
    const tasks = getDisplayTasks(date, state);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ source: 'auto', productId: cremeBrulee.id, multiplier: 1.5 });
  });

  it('reflects a currentQty change immediately (no stored snapshot to go stale)', () => {
    const wellStocked: Product = { ...cremeBrulee, currentQty: 30 };
    const state = baseState({ products: [wellStocked], recipes: [cremeBruleeRecipe] });
    expect(getDisplayTasks(date, state)).toHaveLength(0);
  });

  it('hides a dismissed auto task for that date only', () => {
    const state = baseState({
      products: [cremeBrulee],
      recipes: [cremeBruleeRecipe],
      taskOverrides: [{ id: autoTaskId(cremeBrulee.id, date), productId: cremeBrulee.id, date, dismissed: true }],
    });
    expect(getDisplayTasks(date, state)).toHaveLength(0);
    // a different date is unaffected
    expect(getDisplayTasks('2026-09-06', state)).toHaveLength(1);
  });

  it('applies a manual priority override on top of the computed one', () => {
    const state = baseState({
      products: [cremeBrulee],
      recipes: [cremeBruleeRecipe],
      taskOverrides: [
        {
          id: autoTaskId(cremeBrulee.id, date),
          productId: cremeBrulee.id,
          date,
          priority: 'green',
          priorityManual: true,
        },
      ],
    });
    expect(getDisplayTasks(date, state)[0].priority).toBe('green');
  });

  it('keeps a done auto task visible even after the product is fully restocked', () => {
    const wellStocked: Product = { ...cremeBrulee, currentQty: 30 };
    const state = baseState({
      products: [wellStocked],
      recipes: [cremeBruleeRecipe],
      taskOverrides: [{ id: autoTaskId(cremeBrulee.id, date), productId: cremeBrulee.id, date, done: true }],
    });
    const tasks = getDisplayTasks(date, state);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].done).toBe(true);
  });
});

describe('getDisplayTasks — manual tasks', () => {
  it('includes manual tasks for the date as-is', () => {
    const state = baseState({
      tasks: [
        {
          id: 'task-manual-1',
          date,
          recipeId: 'recipe-x',
          multiplier: 2,
          priority: 'red',
          done: false,
          source: 'manual',
        },
      ],
    });
    const tasks = getDisplayTasks(date, state);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ source: 'manual', priority: 'red', multiplier: 2 });
  });
});

describe('getDisplayTasks — station category', () => {
  it('an auto task takes its category from the recipe, ignoring any categoryOverride', () => {
    const state = baseState({ products: [cremeBrulee], recipes: [cremeBruleeRecipe] });
    expect(getDisplayTasks(date, state)[0].category).toBe('dessert');
  });

  it('a free-text manual task uses its own categoryOverride', () => {
    const state = baseState({
      tasks: [
        {
          id: 'task-manual-1',
          date,
          title: 'לנקות תנור',
          categoryOverride: 'taboon',
          multiplier: 1,
          priority: 'yellow',
          done: false,
          source: 'manual',
        },
      ],
    });
    expect(getDisplayTasks(date, state)[0].category).toBe('taboon');
  });

  it('a manual task with no recipe and no categoryOverride falls back to general', () => {
    const state = baseState({
      tasks: [
        {
          id: 'task-manual-1',
          date,
          title: 'לנקות מדפים',
          multiplier: 1,
          priority: 'yellow',
          done: false,
          source: 'manual',
        },
      ],
    });
    expect(getDisplayTasks(date, state)[0].category).toBe('general');
  });

  it('a manual task linked to a recipe takes the recipe’s category', () => {
    const state = baseState({
      recipes: [cremeBruleeRecipe],
      tasks: [
        {
          id: 'task-manual-1',
          date,
          recipeId: cremeBruleeRecipe.id,
          multiplier: 1,
          priority: 'yellow',
          done: false,
          source: 'manual',
        },
      ],
    });
    expect(getDisplayTasks(date, state)[0].category).toBe('dessert');
  });
});

describe('auto tasks respect the product/recipe unit relationship', () => {
  const kgProduct: Product = {
    id: 'prod-cream',
    name: 'קרם',
    kind: 'component',
    unit: 'kg',
    currentQty: 0,
    weeklyTarget: 0,
    dailyUsage: 2,
    recipeId: 'recipe-cream',
  };

  const gramRecipe: Recipe = {
    id: 'recipe-cream',
    name: 'קרם',
    category: 'cold',
    yieldQty: 500,
    yieldUnit: 'g',
    producesProductId: 'prod-cream',
    items: [],
    steps: [],
  };

  it('converts kg needed into a gram-yield batch count', () => {
    const state = baseState({ products: [kgProduct], recipes: [gramRecipe] });
    const tasks = getDisplayTasks(date, state);
    // 2kg needed = 2000g / 500g per batch = 4 batches
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ multiplier: 4, unitMismatch: undefined });
  });

  it('surfaces the task with a mismatch flag when the units are unrelated', () => {
    const state = baseState({
      products: [kgProduct],
      recipes: [{ ...gramRecipe, yieldQty: 1, yieldUnit: 'unit' }],
    });
    const tasks = getDisplayTasks(date, state);
    // A 0 multiplier here means "can't compute", so the task must stay visible to be fixed
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ multiplier: 0, unitMismatch: true });
  });
});

// ── selectors ────────────────────────────────────────────────────────────────
// The screen and the nav badge both go through these, so a bug here shows the cook two
// different numbers for the same day.

function task(overrides: Partial<DisplayTask> & { id: string }): DisplayTask {
  return {
    date: '2026-09-28',
    multiplier: 1,
    priority: 'yellow',
    done: false,
    source: 'manual',
    category: 'general',
    ...overrides,
  };
}

describe('taskProgress', () => {
  it('counts total, done, open and urgent', () => {
    const p = taskProgress([
      task({ id: 'a', done: true }),
      task({ id: 'b', priority: 'red' }),
      task({ id: 'c', priority: 'red', done: true }),
      task({ id: 'd', priority: 'green' }),
    ]);
    expect(p).toEqual({ total: 4, done: 2, open: 2, ratio: 0.5, urgent: 1 });
  });

  it('counts a done red task as finished, not urgent', () => {
    expect(taskProgress([task({ id: 'a', priority: 'red', done: true })]).urgent).toBe(0);
  });

  it('reports an empty list as complete, not as 0% and not as NaN', () => {
    // "nothing to do" must read as done — a naive done/total gives NaN here and renders an
    // empty progress bar on a day with no work, which says the opposite of the truth.
    expect(taskProgress([]).ratio).toBe(1);
    expect(taskProgress([])).toEqual({ total: 0, done: 0, open: 0, ratio: 1, urgent: 0 });
  });
});

describe('sortDisplayTasks', () => {
  it('puts open tasks before done ones, whatever their priority', () => {
    const sorted = sortDisplayTasks([
      task({ id: 'a', priority: 'red', done: true }),
      task({ id: 'b', priority: 'green' }),
    ]);
    expect(sorted.map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('orders open tasks red, yellow, green', () => {
    const sorted = sortDisplayTasks([
      task({ id: 'c', priority: 'green' }),
      task({ id: 'a', priority: 'red' }),
      task({ id: 'b', priority: 'yellow' }),
    ]);
    expect(sorted.map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('is deterministic for equal priorities, so two devices agree', () => {
    const input = [task({ id: 'z' }), task({ id: 'm' }), task({ id: 'a' })];
    expect(sortDisplayTasks(input).map((t) => t.id)).toEqual(['a', 'm', 'z']);
    // Same answer whatever order getDisplayTasks happened to build the array in.
    expect(sortDisplayTasks([...input].reverse()).map((t) => t.id)).toEqual(['a', 'm', 'z']);
  });

  it('does not mutate its input', () => {
    const input = [task({ id: 'b', priority: 'green' }), task({ id: 'a', priority: 'red' })];
    sortDisplayTasks(input);
    expect(input.map((t) => t.id)).toEqual(['b', 'a']);
  });
});

describe('groupByStation', () => {
  const stations = [
    { id: 'st-hot', name: 'פס חם', createdAt: '2026-01-01' },
    { id: 'st-cold', name: 'פס קר', createdAt: '2026-01-01' },
  ];

  it('groups in the kitchen\'s own station order and drops empty stations', () => {
    const groups = groupByStation(
      [task({ id: 'a', category: 'st-cold' }), task({ id: 'b', category: 'general' })],
      stations,
    );
    // 'פס חם' has nothing open, so it isn't rendered at all.
    expect(groups.map((g) => g.value)).toEqual(['st-cold', 'general']);
    expect(groups.map((g) => g.label)).toEqual(['פס קר', 'כללי']);
  });

  it('sorts within each group by the same rule as the flat list', () => {
    const groups = groupByStation(
      [
        task({ id: 'a', category: 'st-hot', priority: 'green' }),
        task({ id: 'b', category: 'st-hot', priority: 'red' }),
        task({ id: 'c', category: 'st-hot', priority: 'red', done: true }),
      ],
      stations,
    );
    expect(groups[0].tasks.map((t) => t.id)).toEqual(['b', 'a', 'c']);
  });

  it('always offers the general bucket, even with no stations at all', () => {
    const groups = groupByStation([task({ id: 'a', category: 'general' })], []);
    expect(groups.map((g) => g.value)).toEqual(['general']);
    expect(groupByStation([task({ id: 'a' })], undefined)).toHaveLength(1);
  });

  it('returns nothing for an empty task list', () => {
    expect(groupByStation([], stations)).toEqual([]);
  });
});

describe('tasks missing a raw ingredient', () => {
  const eggs = { id: 'ing-egg', name: 'ביצים', unit: 'unit' as const, currentQty: 100, dailyUsage: 1, weeklyUsage: 7 };
  const milk = { id: 'ing-milk', name: 'חלב', unit: 'l' as const, currentQty: 50, dailyUsage: 1, weeklyUsage: 7 };
  const recipe: Recipe = {
    ...cremeBruleeRecipe,
    items: [
      { refType: 'ingredient', refId: 'ing-egg', qty: 4, unit: 'unit' },
      { refType: 'ingredient', refId: 'ing-milk', qty: 500, unit: 'ml' },
    ],
  };
  const withStock = (overrides: Partial<Ingredient>[]) =>
    baseState({ products: [cremeBrulee], recipes: [recipe], ingredients: [{ ...eggs, ...overrides[0] }, { ...milk, ...overrides[1] }] });

  it('is empty when everything needed is on the shelf', () => {
    expect(blockedIngredients(recipe, 1, withStock([{}, {}]))).toEqual([]);
  });

  it('names an ingredient whose stock is below what the multiplier needs', () => {
    // 1.5 batches need 6 eggs; there are 5.
    expect(blockedIngredients(recipe, 1.5, withStock([{ currentQty: 5 }, {}]))).toEqual(['ביצים']);
  });

  it('compares in the ingredient’s own unit (500 ml against litres)', () => {
    expect(blockedIngredients(recipe, 1, withStock([{}, { currentQty: 0.4 }]))).toEqual(['חלב']);
    expect(blockedIngredients(recipe, 1, withStock([{}, { currentQty: 0.6 }]))).toEqual([]);
  });

  it('counts a cook’s "חסר" flag even when the numbers look fine', () => {
    expect(blockedIngredients(recipe, 1, withStock([{ shortFlag: true }, {}]))).toEqual(['ביצים']);
  });

  it('does not guess across unit families', () => {
    const weird = { ...recipe, items: [{ refType: 'ingredient' as const, refId: 'ing-egg', qty: 5, unit: 'kg' as const }] };
    expect(blockedIngredients(weird, 1, withStock([{ currentQty: 0 }, {}]))).toEqual([]);
  });

  it('marks the live task, and not once it is done', () => {
    const open = getDisplayTasks(date, withStock([{ currentQty: 1 }, {}]));
    expect(open[0].blocked).toEqual(['ביצים']);
    const done = getDisplayTasks(date, {
      ...withStock([{ currentQty: 1 }, {}]),
      taskOverrides: [{ id: autoTaskId(cremeBrulee.id, date), productId: cremeBrulee.id, date, done: true }],
    });
    expect(done[0].blocked).toBeUndefined();
  });

  it('sorts blocked tasks above others of the same priority, but below the finished-last rule', () => {
    const mk = (id: string, extra: Partial<DisplayTask>): DisplayTask => ({
      id, date, multiplier: 1, priority: 'yellow', done: false, source: 'manual', category: 'general', ...extra,
    });
    const sorted = sortDisplayTasks([
      mk('a', {}),
      mk('b', { blocked: ['ביצים'] }),
      mk('c', { priority: 'red' }),
      mk('d', { blocked: ['חלב'], done: true }),
    ]);
    // blocked beats priority; a finished task stays last whatever it was missing.
    expect(sorted.map((t) => t.id)).toEqual(['b', 'c', 'a', 'd']);
  });
});
