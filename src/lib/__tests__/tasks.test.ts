import { describe, expect, it } from 'vitest';
import { autoTaskId, getDisplayTasks } from '../tasks';
import type { AppState, Product, Recipe } from '../../types';

function baseState(overrides: Partial<AppState> = {}): AppState {
  return {
    schemaVersion: 2,
    settings: { defaultCoverageDays: 1, weekStartsOn: 0, roundMultiplierTo: 0.25 },
    cooks: [],
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
