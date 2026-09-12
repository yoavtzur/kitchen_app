import { describe, expect, it } from 'vitest';
import { reducer } from '../reducer';
import { autoTaskId, getDisplayTasks } from '../../lib/tasks';
import { todayStr } from '../../lib/date';
import type { AppState, Product, Recipe } from '../../types';

function baseState(overrides: Partial<AppState> = {}): AppState {
  return {
    schemaVersion: 2,
    settings: { defaultCoverageDays: 1, weekStartsOn: 0, roundMultiplierTo: 0.25 },
    cooks: [],
    stations: [],
    ingredients: [{ id: 'ing-egg', name: 'ביצים', unit: 'unit', currentQty: 60, dailyUsage: 20, weeklyUsage: 140 }],
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

const recipe: Recipe = {
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

describe('SET_PRODUCT_QTY clears today’s manual prep override', () => {
  it('drops prepOverride for today but leaves other dates untouched', () => {
    const state = baseState({
      products: [cremeBrulee],
      dayPlans: [
        { date, entries: [{ productId: cremeBrulee.id, prepOverride: 20 }] },
        { date: '2026-09-12', entries: [{ productId: cremeBrulee.id, prepOverride: 30 }] },
      ],
    });
    const next = reducer(state, { type: 'SET_PRODUCT_QTY', id: cremeBrulee.id, qty: 5, today: date });
    const todayEntry = next.dayPlans.find((p) => p.date === date)?.entries[0];
    const futureEntry = next.dayPlans.find((p) => p.date === '2026-09-12')?.entries[0];
    expect(todayEntry?.prepOverride).toBeUndefined();
    expect(futureEntry?.prepOverride).toBe(30);
  });
});

describe('SET_INGREDIENT_UNIT', () => {
  const tomatoes = {
    id: 'ing-tomato',
    name: 'עגבניות',
    unit: 'kg' as const,
    currentQty: 4,
    dailyUsage: 1.5,
    weeklyUsage: 10,
    parLevel: 12,
    dailyUsageByWeekday: { 5: 3 },
  };

  it('converts currentQty/dailyUsage/weeklyUsage/parLevel/weekday overrides within the same family', () => {
    const state = baseState({ ingredients: [tomatoes] });
    const next = reducer(state, { type: 'SET_INGREDIENT_UNIT', id: 'ing-tomato', unit: 'g' });
    expect(next.ingredients[0]).toMatchObject({
      unit: 'g',
      currentQty: 4000,
      dailyUsage: 1500,
      weeklyUsage: 10000,
      parLevel: 12000,
      dailyUsageByWeekday: { 5: 3000 },
    });
  });

  it('converts a matching order-line override in the same family', () => {
    const state = baseState({
      ingredients: [tomatoes],
      orderLines: [{ ingredientId: 'ing-tomato', date, qtyOverride: 2, ordered: false }],
    });
    const next = reducer(state, { type: 'SET_INGREDIENT_UNIT', id: 'ing-tomato', unit: 'g' });
    expect(next.orderLines[0].qtyOverride).toBe(2000);
  });

  it('leaves an unrelated ingredient’s order line untouched', () => {
    const state = baseState({
      ingredients: [tomatoes],
      orderLines: [{ ingredientId: 'ing-egg', date, qtyOverride: 30, ordered: false }],
    });
    const next = reducer(state, { type: 'SET_INGREDIENT_UNIT', id: 'ing-tomato', unit: 'g' });
    expect(next.orderLines[0].qtyOverride).toBe(30);
  });

  it('a no-op when the unit is unchanged', () => {
    const state = baseState({ ingredients: [tomatoes] });
    const next = reducer(state, { type: 'SET_INGREDIENT_UNIT', id: 'ing-tomato', unit: 'kg' });
    expect(next).toEqual(state);
  });

  it('a cross-family change (weight -> count) relabels the unit but leaves the numbers as-is', () => {
    const state = baseState({ ingredients: [tomatoes] });
    const next = reducer(state, { type: 'SET_INGREDIENT_UNIT', id: 'ing-tomato', unit: 'unit' });
    expect(next.ingredients[0]).toMatchObject({ unit: 'unit', currentQty: 4, dailyUsage: 1.5, weeklyUsage: 10, parLevel: 12 });
  });

  it('an unknown ingredient id leaves state untouched', () => {
    const state = baseState({ ingredients: [tomatoes] });
    const next = reducer(state, { type: 'SET_INGREDIENT_UNIT', id: 'no-such-id', unit: 'g' });
    expect(next).toEqual(state);
  });
});

describe('auto task completion + undo round trip', () => {
  it('undo restores ingredients and product exactly as they were before confirmation', () => {
    const state = baseState({ products: [cremeBrulee], recipes: [recipe] });
    const id = autoTaskId(cremeBrulee.id, date);

    const afterConfirm = reducer(state, {
      type: 'CONFIRM_AUTO_TASK_COMPLETION',
      id,
      productId: cremeBrulee.id,
      date,
      ingredientDeltas: [{ id: 'ing-egg', delta: 9 }],
      producedProductId: cremeBrulee.id,
      producedQty: 12,
    });

    expect(afterConfirm.ingredients[0].currentQty).toBe(51);
    expect(afterConfirm.products[0].currentQty).toBe(15);
    expect(afterConfirm.taskOverrides[0]).toMatchObject({ id, done: true });

    const afterUndo = reducer(afterConfirm, { type: 'UNDO_AUTO_TASK_COMPLETION', id });

    expect(afterUndo.ingredients[0].currentQty).toBe(60);
    expect(afterUndo.products[0].currentQty).toBe(3);
    expect(afterUndo.taskOverrides[0]).toMatchObject({ id, done: false, appliedCompletion: undefined });
  });

  it('dismissing an auto task does not touch inventory even if it was completed', () => {
    const state = baseState({ products: [cremeBrulee], recipes: [recipe] });
    const id = autoTaskId(cremeBrulee.id, date);
    const afterConfirm = reducer(state, {
      type: 'CONFIRM_AUTO_TASK_COMPLETION',
      id,
      productId: cremeBrulee.id,
      date,
      ingredientDeltas: [{ id: 'ing-egg', delta: 9 }],
      producedProductId: cremeBrulee.id,
      producedQty: 12,
    });
    const afterDismiss = reducer(afterConfirm, { type: 'DISMISS_AUTO_TASK', id, productId: cremeBrulee.id, date });
    expect(afterDismiss.ingredients[0].currentQty).toBe(51);
    expect(afterDismiss.products[0].currentQty).toBe(15);
    expect(afterDismiss.taskOverrides[0]).toMatchObject({ id, dismissed: true });
  });
});

describe('task completion is idempotent', () => {
  it('CONFIRM_AUTO_TASK_COMPLETION on an already-done task does not deduct twice', () => {
    const state = baseState({ products: [cremeBrulee], recipes: [recipe] });
    const id = autoTaskId(cremeBrulee.id, date);
    const confirmAction = {
      type: 'CONFIRM_AUTO_TASK_COMPLETION' as const,
      id,
      productId: cremeBrulee.id,
      date,
      ingredientDeltas: [{ id: 'ing-egg', delta: 9 }],
      producedProductId: cremeBrulee.id,
      producedQty: 12,
    };
    const once = reducer(state, confirmAction);
    // Two cooks confirming the same auto task at once (or a rebased/retried op) must not
    // deduct the ingredients a second time.
    const twice = reducer(once, confirmAction);
    expect(twice.ingredients[0].currentQty).toBe(51);
    expect(twice.products[0].currentQty).toBe(15);
    expect(twice).toBe(once); // no-op returns the same state reference
  });

  it('CONFIRM_TASK_COMPLETION on an already-done manual task does not deduct twice', () => {
    const task = {
      id: 'task-manual-1',
      date,
      recipeId: recipe.id,
      multiplier: 1,
      priority: 'yellow' as const,
      done: false,
      source: 'manual' as const,
    };
    const state = baseState({ products: [cremeBrulee], recipes: [recipe], tasks: [task] });
    const confirmAction = {
      type: 'CONFIRM_TASK_COMPLETION' as const,
      taskId: task.id,
      ingredientDeltas: [{ id: 'ing-egg', delta: 9 }],
      producedProductId: cremeBrulee.id,
      producedQty: 12,
    };
    const once = reducer(state, confirmAction);
    const twice = reducer(once, confirmAction);
    expect(twice.ingredients[0].currentQty).toBe(51);
    expect(twice.products[0].currentQty).toBe(15);
    expect(twice).toBe(once);
  });
});

describe('a dismissed auto task reappears after a real quantity update', () => {
  it('SET_DAY_PLAN_ENTRY (prep override) un-dismisses the task for that date', () => {
    const state = baseState({ products: [cremeBrulee], recipes: [recipe] });
    const id = autoTaskId(cremeBrulee.id, date);
    const afterDismiss = reducer(state, { type: 'DISMISS_AUTO_TASK', id, productId: cremeBrulee.id, date });
    expect(getDisplayTasks(date, afterDismiss)).toHaveLength(0);

    const afterPrepEdit = reducer(afterDismiss, {
      type: 'SET_DAY_PLAN_ENTRY',
      date,
      entry: { productId: cremeBrulee.id, prepOverride: 16 },
    });
    const tasks = getDisplayTasks(date, afterPrepEdit);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ multiplier: 2 }); // 16 / yieldQty 8
  });

  it('SET_PRODUCT_QTY un-dismisses today’s task if there is still a need', () => {
    const today = todayStr();
    const state = baseState({ products: [cremeBrulee], recipes: [recipe] });
    const id = autoTaskId(cremeBrulee.id, today);
    const afterDismiss = reducer(state, { type: 'DISMISS_AUTO_TASK', id, productId: cremeBrulee.id, date: today });
    expect(getDisplayTasks(today, afterDismiss)).toHaveLength(0);

    const afterQtyEdit = reducer(afterDismiss, { type: 'SET_PRODUCT_QTY', id: cremeBrulee.id, qty: 3 });
    expect(afterQtyEdit.taskOverrides.find((o) => o.id === id)?.dismissed).toBe(false);
    expect(getDisplayTasks(today, afterQtyEdit)).toHaveLength(1);
  });
});

describe('SAVE_PREP_ITEM links both halves of a prep item', () => {
  const newRecipe: Recipe = {
    id: 'recipe-zucchini',
    name: 'קרם זוקיני',
    category: 'cold',
    yieldQty: 5,
    yieldUnit: 'unit',
    producesProductId: 'prod-zucchini',
    items: [],
    steps: [],
  };

  const newProduct: Product = {
    id: 'prod-zucchini',
    name: 'קרם זוקיני',
    kind: 'component',
    unit: 'unit',
    currentQty: 0,
    weeklyTarget: 70,
    dailyUsage: 10,
    recipeId: 'recipe-zucchini',
  };

  it('creates both sides and the auto task appears immediately', () => {
    const next = reducer(baseState(), {
      type: 'SAVE_PREP_ITEM',
      recipe: newRecipe,
      product: newProduct,
    });

    expect(next.products[0]).toMatchObject({ id: 'prod-zucchini', recipeId: 'recipe-zucchini' });
    expect(next.recipes[0]).toMatchObject({
      id: 'recipe-zucchini',
      producesProductId: 'prod-zucchini',
    });
    // dailyUsage 10, nothing in stock, batch of 5 -> 2 batches, with no extra "regenerate" step
    const tasks = getDisplayTasks(todayStr(), next);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ source: 'auto', multiplier: 2, productId: 'prod-zucchini' });
  });

  it('forces the recipe to yield in the product stock unit', () => {
    const next = reducer(baseState(), {
      type: 'SAVE_PREP_ITEM',
      recipe: { ...newRecipe, yieldUnit: 'g' },
      product: { ...newProduct, unit: 'kg' },
    });
    expect(next.recipes[0].yieldUnit).toBe('kg');
  });

  it('editing an existing item updates it in place rather than duplicating', () => {
    const created = reducer(baseState(), {
      type: 'SAVE_PREP_ITEM',
      recipe: newRecipe,
      product: newProduct,
    });
    const edited = reducer(created, {
      type: 'SAVE_PREP_ITEM',
      recipe: { ...newRecipe, yieldQty: 10 },
      product: { ...newProduct, currentQty: 4 },
    });

    expect(edited.recipes).toHaveLength(1);
    expect(edited.products).toHaveLength(1);
    expect(edited.recipes[0].yieldQty).toBe(10);
    expect(edited.products[0].currentQty).toBe(4);
  });

  it('unlinks a product that previously claimed the same recipe', () => {
    const stale: Product = { ...cremeBrulee, id: 'prod-stale', recipeId: 'recipe-zucchini' };
    const next = reducer(baseState({ products: [stale] }), {
      type: 'SAVE_PREP_ITEM',
      recipe: newRecipe,
      product: newProduct,
    });
    expect(next.products.find((p) => p.id === 'prod-stale')?.recipeId).toBeUndefined();
    expect(next.products.find((p) => p.id === 'prod-zucchini')?.recipeId).toBe('recipe-zucchini');
  });
});

describe('deletes cascade through the whole state', () => {
  function linkedState(): AppState {
    return baseState({
      products: [cremeBrulee],
      recipes: [
        recipe,
        {
          id: 'recipe-trifle',
          name: 'טריפל',
          category: 'dessert',
          yieldQty: 1,
          yieldUnit: 'unit',
          items: [{ refType: 'product', refId: cremeBrulee.id, qty: 2, unit: 'unit' }],
          steps: [],
        },
      ],
      tasks: [
        {
          id: 'task-1',
          date,
          recipeId: recipe.id,
          multiplier: 1,
          priority: 'red',
          done: false,
          source: 'manual',
        },
      ],
      taskOverrides: [{ id: autoTaskId(cremeBrulee.id, date), productId: cremeBrulee.id, date, dismissed: true }],
      dayPlans: [{ date, entries: [{ productId: cremeBrulee.id, prepOverride: 20 }] }],
    });
  }

  it('DELETE_RECIPE removes the product and every reference to it', () => {
    const next = reducer(linkedState(), { type: 'DELETE_RECIPE', id: recipe.id });

    expect(next.recipes.map((r) => r.id)).toEqual(['recipe-trifle']);
    expect(next.products).toEqual([]);
    expect(next.recipes[0].items).toEqual([]); // trifle no longer consumes a deleted product
    expect(next.tasks).toEqual([]);
    expect(next.taskOverrides).toEqual([]);
    expect(next.dayPlans).toEqual([]);
    expect(getDisplayTasks(date, next)).toEqual([]);
  });

  it('DELETE_PRODUCT removes the recipe too', () => {
    const next = reducer(linkedState(), { type: 'DELETE_PRODUCT', id: cremeBrulee.id });
    expect(next.recipes.map((r) => r.id)).toEqual(['recipe-trifle']);
    expect(next.products).toEqual([]);
  });

  it('DELETE_INGREDIENT strips the ingredient from every recipe', () => {
    const state = baseState({
      recipes: [
        { ...recipe, items: [{ refType: 'ingredient', refId: 'ing-egg', qty: 6, unit: 'unit' }] },
      ],
      orderLines: [{ ingredientId: 'ing-egg', date, ordered: true }],
    });
    const next = reducer(state, { type: 'DELETE_INGREDIENT', id: 'ing-egg' });

    expect(next.ingredients).toEqual([]);
    expect(next.recipes[0].items).toEqual([]);
    expect(next.orderLines).toEqual([]);
  });
});

describe('SET_TASK_ASSIGNEE', () => {
  it('assigns a manual task to a cook, and null unassigns', () => {
    const task = {
      id: 'task-manual-1',
      date,
      title: 'לנקות מדפים',
      categoryOverride: 'taboon' as const,
      multiplier: 1,
      priority: 'yellow' as const,
      done: false,
      source: 'manual' as const,
    };
    const state = baseState({ tasks: [task] });
    const assigned = reducer(state, { type: 'SET_TASK_ASSIGNEE', id: task.id, assigneeId: 'cook-1' });
    expect(assigned.tasks[0].assigneeId).toBe('cook-1');
    const unassigned = reducer(assigned, { type: 'SET_TASK_ASSIGNEE', id: task.id, assigneeId: null });
    expect(unassigned.tasks[0].assigneeId).toBeUndefined();
  });
});

describe('REMOVE_COOK', () => {
  const openTask = {
    id: 'task-manual-open',
    date,
    title: 'לנקות מדפים',
    categoryOverride: 'taboon' as const,
    multiplier: 1,
    priority: 'yellow' as const,
    assigneeId: 'cook-1',
    done: false,
    source: 'manual' as const,
  };
  const doneTask = {
    ...openTask,
    id: 'task-manual-done',
    done: true,
  };
  const openOverride = {
    id: autoTaskId(cremeBrulee.id, date),
    productId: cremeBrulee.id,
    date,
    assigneeId: 'cook-1',
    done: false,
  };
  const doneOverride = {
    ...openOverride,
    id: autoTaskId(cremeBrulee.id, '2026-09-06'),
    date: '2026-09-06',
    done: true,
  };

  it('removes the cook and unassigns open tasks/overrides but keeps completed ones', () => {
    const state = baseState({
      cooks: [{ id: 'cook-1', name: 'דני', color: '#fff' }],
      products: [cremeBrulee],
      tasks: [openTask, doneTask],
      taskOverrides: [openOverride, doneOverride],
    });
    const next = reducer(state, { type: 'REMOVE_COOK', id: 'cook-1' });
    expect(next.cooks).toHaveLength(0);
    expect(next.tasks.find((t) => t.id === openTask.id)?.assigneeId).toBeUndefined();
    expect(next.tasks.find((t) => t.id === doneTask.id)?.assigneeId).toBe('cook-1');
    expect(next.taskOverrides.find((o) => o.id === openOverride.id)?.assigneeId).toBeUndefined();
    expect(next.taskOverrides.find((o) => o.id === doneOverride.id)?.assigneeId).toBe('cook-1');
  });
});

describe('ADD_STATION', () => {
  it('adds a valid station to an empty list', () => {
    const state = baseState();
    const next = reducer(state, {
      type: 'ADD_STATION',
      station: { id: 'station-1', name: 'פס חם', createdAt: date },
    });
    expect(next.stations).toEqual([{ id: 'station-1', name: 'פס חם', createdAt: date }]);
  });

  it('ignores a duplicate station name, case- and whitespace-insensitively', () => {
    const state = baseState({ stations: [{ id: 'station-1', name: 'פס חם', createdAt: date }] });
    const next = reducer(state, {
      type: 'ADD_STATION',
      station: { id: 'station-2', name: '  פס חם  ', createdAt: date },
    });
    expect(next.stations).toHaveLength(1);
    expect(next.stations[0].id).toBe('station-1');
  });

  it('ignores an empty or whitespace-only station name', () => {
    const state = baseState();
    const next = reducer(state, {
      type: 'ADD_STATION',
      station: { id: 'station-1', name: '   ', createdAt: date },
    });
    expect(next.stations).toHaveLength(0);
  });
});

describe('order sheet', () => {
  it('persists a typed quantity and the ordered flag per ingredient', () => {
    const withQty = reducer(baseState(), {
      type: 'SET_ORDER_LINE_QTY',
      ingredientId: 'ing-egg',
      date,
      qtyOverride: 120,
    });
    const withFlag = reducer(withQty, {
      type: 'SET_ORDER_LINE_ORDERED',
      ingredientId: 'ing-egg',
      date,
      ordered: true,
    });

    expect(withFlag.orderLines).toEqual([{ ingredientId: 'ing-egg', date, qtyOverride: 120, ordered: true }]);
  });

  it('RECEIVE_ORDER adds exactly what arrived and clears those rows', () => {
    const state = baseState({ orderLines: [{ ingredientId: 'ing-egg', date, qtyOverride: 120, ordered: true }] });
    const next = reducer(state, {
      type: 'RECEIVE_ORDER',
      date,
      receipts: [{ ingredientId: 'ing-egg', qty: 120 }],
    });

    expect(next.ingredients[0].currentQty).toBe(180); // 60 on hand + 120 received
    expect(next.orderLines).toEqual([]);
  });

  it('leaves rows that were not received alone', () => {
    const state = baseState({
      ingredients: [
        { id: 'ing-egg', name: 'ביצים', unit: 'unit', currentQty: 60, dailyUsage: 20, weeklyUsage: 140 },
        { id: 'ing-flour', name: 'קמח', unit: 'kg', currentQty: 5, dailyUsage: 2, weeklyUsage: 14 },
      ],
      orderLines: [
        { ingredientId: 'ing-egg', date, ordered: true },
        { ingredientId: 'ing-flour', date, ordered: false },
      ],
    });
    const next = reducer(state, {
      type: 'RECEIVE_ORDER',
      date,
      receipts: [{ ingredientId: 'ing-egg', qty: 30 }],
    });

    expect(next.ingredients.find((i) => i.id === 'ing-flour')?.currentQty).toBe(5);
    expect(next.orderLines).toEqual([{ ingredientId: 'ing-flour', date, ordered: false }]);
  });

  it('RECEIVE_ORDER is idempotent: a duplicate/retried receipt does not add stock twice', () => {
    const state = baseState({ orderLines: [{ ingredientId: 'ing-egg', date, qtyOverride: 120, ordered: true }] });
    const once = reducer(state, {
      type: 'RECEIVE_ORDER',
      date,
      receipts: [{ ingredientId: 'ing-egg', qty: 120 }],
    });
    // The same op replayed (or two cooks tapping "קבלת סחורה" at once) after the line is
    // already gone must be a no-op, not a second addition to stock.
    const twice = reducer(once, {
      type: 'RECEIVE_ORDER',
      date,
      receipts: [{ ingredientId: 'ing-egg', qty: 120 }],
    });
    expect(twice.ingredients[0].currentQty).toBe(180);
    expect(twice).toBe(once); // no-op returns the same state reference
  });

  it('SET_ORDER_LINE_ORDERED is absolute, not a toggle: applying the same value twice is stable', () => {
    const once = reducer(baseState(), {
      type: 'SET_ORDER_LINE_ORDERED',
      ingredientId: 'ing-egg',
      date,
      ordered: true,
    });
    const twice = reducer(once, {
      type: 'SET_ORDER_LINE_ORDERED',
      ingredientId: 'ing-egg',
      date,
      ordered: true,
    });
    expect(twice.orderLines).toEqual([{ ingredientId: 'ing-egg', date, ordered: true }]);
  });

  it('SUBMIT_ORDER absolutely sets qtyOverride and ordered for every submitted line', () => {
    const next = reducer(baseState(), {
      type: 'SUBMIT_ORDER',
      date,
      lines: [{ ingredientId: 'ing-egg', qty: 45 }],
    });
    expect(next.orderLines).toEqual([{ ingredientId: 'ing-egg', date, qtyOverride: 45, ordered: true }]);
  });

  it('CLEAR_ORDER_SHEET only clears the given date, leaving other dates untouched', () => {
    const state = baseState({
      orderLines: [
        { ingredientId: 'ing-egg', date, ordered: true },
        { ingredientId: 'ing-egg', date: '2026-09-12', ordered: true },
      ],
    });
    const next = reducer(state, { type: 'CLEAR_ORDER_SHEET', date });
    expect(next.orderLines).toEqual([{ ingredientId: 'ing-egg', date: '2026-09-12', ordered: true }]);
  });
});

describe('per-weekday dailyUsage overrides', () => {
  it('SET_PRODUCT_WEEKDAY_USAGE sets one weekday without touching others', () => {
    const state = baseState({ products: [cremeBrulee] });
    const withFriday = reducer(state, {
      type: 'SET_PRODUCT_WEEKDAY_USAGE',
      id: cremeBrulee.id,
      weekday: 5,
      dailyUsage: 40,
    });
    expect(withFriday.products[0].dailyUsageByWeekday).toEqual({ 5: 40 });

    const withSaturdayToo = reducer(withFriday, {
      type: 'SET_PRODUCT_WEEKDAY_USAGE',
      id: cremeBrulee.id,
      weekday: 6,
      dailyUsage: 5,
    });
    expect(withSaturdayToo.products[0].dailyUsageByWeekday).toEqual({ 5: 40, 6: 5 });
  });

  it('clearing the only override drops the map entirely rather than leaving {}', () => {
    const state = baseState({
      products: [{ ...cremeBrulee, dailyUsageByWeekday: { 5: 40 } }],
    });
    const next = reducer(state, {
      type: 'SET_PRODUCT_WEEKDAY_USAGE',
      id: cremeBrulee.id,
      weekday: 5,
      dailyUsage: undefined,
    });
    expect(next.products[0].dailyUsageByWeekday).toBeUndefined();
  });

  it('SET_INGREDIENT_WEEKDAY_USAGE mirrors the same behaviour for ingredients', () => {
    const state = baseState();
    const next = reducer(state, {
      type: 'SET_INGREDIENT_WEEKDAY_USAGE',
      id: 'ing-egg',
      weekday: 5,
      dailyUsage: 30,
    });
    expect(next.ingredients[0].dailyUsageByWeekday).toEqual({ 5: 30 });
  });
});

describe('BULK_UPDATE_QUANTITIES', () => {
  it('applies plain ingredient updates and product updates through the same path as SET_PRODUCT_QTY', () => {
    const state = baseState({
      products: [cremeBrulee],
      dayPlans: [{ date, entries: [{ productId: cremeBrulee.id, prepOverride: 20 }] }],
    });
    const next = reducer(state, {
      type: 'BULK_UPDATE_QUANTITIES',
      ingredients: [{ id: 'ing-egg', qty: 48 }],
      products: [{ id: cremeBrulee.id, qty: 5 }],
      today: date,
    });

    expect(next.ingredients[0].currentQty).toBe(48);
    expect(next.products[0].currentQty).toBe(5);
    // the product update went through applyProductQtyUpdate, so today's stale prep
    // override was cleared exactly like a manual SET_PRODUCT_QTY would clear it
    const todaysEntry = next.dayPlans.find((p) => p.date === date)?.entries[0];
    expect(todaysEntry?.prepOverride).toBeUndefined();
  });

  it('ignores entries for ids not present in the update lists', () => {
    const state = baseState({ products: [cremeBrulee] });
    const next = reducer(state, {
      type: 'BULK_UPDATE_QUANTITIES',
      ingredients: [],
      products: [],
    });
    expect(next).toEqual(state);
  });
});

describe('SET_PRODUCT_QTY’s explicit `today` makes the reducer clock-independent', () => {
  it('a stamped `today` of yesterday does not clear today’s prepOverride', () => {
    const state = baseState({
      products: [cremeBrulee],
      dayPlans: [{ date, entries: [{ productId: cremeBrulee.id, prepOverride: 20 }] }],
    });
    // A stale/delayed op stamped with yesterday's date must not touch today's override —
    // proving the reducer no longer reads the wall clock itself.
    const yesterday = '2026-09-04';
    const next = reducer(state, {
      type: 'SET_PRODUCT_QTY',
      id: cremeBrulee.id,
      qty: 5,
      today: yesterday,
    });
    expect(next.dayPlans.find((p) => p.date === date)?.entries[0].prepOverride).toBe(20);
  });
});

describe('null clears a field; undefined/omitted leaves it untouched', () => {
  it('SET_DAY_PLAN_ENTRY: prepOverride: null clears an existing manual override', () => {
    const state = baseState({
      products: [cremeBrulee],
      dayPlans: [{ date, entries: [{ productId: cremeBrulee.id, prepOverride: 20 }] }],
    });
    const next = reducer(state, {
      type: 'SET_DAY_PLAN_ENTRY',
      date,
      entry: { productId: cremeBrulee.id, prepOverride: null },
    });
    expect(next.dayPlans.find((p) => p.date === date)?.entries[0].prepOverride).toBeUndefined();
  });

  it('SET_ORDER_LINE_QTY: qtyOverride: null clears back to the suggested quantity', () => {
    const withOverride = reducer(baseState(), {
      type: 'SET_ORDER_LINE_QTY',
      ingredientId: 'ing-egg',
      date,
      qtyOverride: 120,
    });
    const cleared = reducer(withOverride, {
      type: 'SET_ORDER_LINE_QTY',
      ingredientId: 'ing-egg',
      date,
      qtyOverride: null,
    });
    expect(cleared.orderLines[0].qtyOverride).toBeUndefined();
  });

  it('SET_AUTO_TASK_ASSIGNEE: assigneeId: null unassigns', () => {
    const state = baseState({ products: [cremeBrulee], recipes: [recipe] });
    const id = autoTaskId(cremeBrulee.id, date);
    const assigned = reducer(state, {
      type: 'SET_AUTO_TASK_ASSIGNEE',
      id,
      productId: cremeBrulee.id,
      date,
      assigneeId: 'cook-1',
    });
    const unassigned = reducer(assigned, {
      type: 'SET_AUTO_TASK_ASSIGNEE',
      id,
      productId: cremeBrulee.id,
      date,
      assigneeId: null,
    });
    expect(unassigned.taskOverrides[0].assigneeId).toBeUndefined();
  });
});

describe('actions survive a JSON round trip', () => {
  // Every Action is dispatched exactly as JS values today, but once it also has to flow through
  // localStorage (an offline queue) or the network (a synced op log) it is forced through
  // JSON.stringify/JSON.parse first — which silently drops any object key whose value is
  // `undefined`. An action that relied on such a key being *present* (rather than merely having
  // no value) would then behave differently after the round trip than it did before it. This
  // table asserts the reducer is immune to that for every action shape that carries an optional
  // field, so the fix (and any future action) can't regress silently.
  const scenarios: { name: string; state: AppState; action: Parameters<typeof reducer>[1] }[] = [
    {
      name: 'SET_DAY_PLAN_ENTRY clearing prepOverride',
      state: baseState({
        products: [cremeBrulee],
        dayPlans: [{ date, entries: [{ productId: cremeBrulee.id, prepOverride: 20 }] }],
      }),
      action: { type: 'SET_DAY_PLAN_ENTRY', date, entry: { productId: cremeBrulee.id, prepOverride: null } },
    },
    {
      name: 'SET_DAY_PLAN_ENTRY setting prepOverride',
      state: baseState({ products: [cremeBrulee] }),
      action: { type: 'SET_DAY_PLAN_ENTRY', date, entry: { productId: cremeBrulee.id, prepOverride: 16 } },
    },
    {
      name: 'SET_ORDER_LINE_QTY clearing qtyOverride',
      state: baseState({ orderLines: [{ ingredientId: 'ing-egg', date, qtyOverride: 120, ordered: false }] }),
      action: { type: 'SET_ORDER_LINE_QTY', ingredientId: 'ing-egg', date, qtyOverride: null },
    },
    {
      name: 'SET_AUTO_TASK_ASSIGNEE clearing assigneeId',
      state: baseState({
        products: [cremeBrulee],
        recipes: [recipe],
        taskOverrides: [{ id: autoTaskId(cremeBrulee.id, date), productId: cremeBrulee.id, date, assigneeId: 'cook-1' }],
      }),
      action: {
        type: 'SET_AUTO_TASK_ASSIGNEE',
        id: autoTaskId(cremeBrulee.id, date),
        productId: cremeBrulee.id,
        date,
        assigneeId: null,
      },
    },
    {
      name: 'SET_PRODUCT_QTY with an explicit today',
      state: baseState({ products: [cremeBrulee] }),
      action: { type: 'SET_PRODUCT_QTY', id: cremeBrulee.id, qty: 7, today: date },
    },
    {
      name: 'SET_INGREDIENT_USAGE with only one of two optional fields',
      state: baseState(),
      action: { type: 'SET_INGREDIENT_USAGE', id: 'ing-egg', dailyUsage: 25 },
    },
    {
      name: 'CONFIRM_AUTO_TASK_COMPLETION with no produced product',
      state: baseState({ products: [cremeBrulee], recipes: [recipe] }),
      action: {
        type: 'CONFIRM_AUTO_TASK_COMPLETION',
        id: autoTaskId(cremeBrulee.id, date),
        productId: cremeBrulee.id,
        date,
        ingredientDeltas: [{ id: 'ing-egg', delta: 9 }],
      },
    },
    {
      name: 'REMOVE_COOK unassigning open tasks',
      state: baseState({
        cooks: [{ id: 'cook-1', name: 'דני', color: '#fff' }],
        tasks: [
          {
            id: 'task-manual-open',
            date,
            title: 'לנקות מדפים',
            multiplier: 1,
            priority: 'yellow',
            assigneeId: 'cook-1',
            done: false,
            source: 'manual',
          },
        ],
      }),
      action: { type: 'REMOVE_COOK', id: 'cook-1' },
    },
  ];

  it.each(scenarios)('$name', ({ state, action }) => {
    const direct = reducer(state, action);
    const roundTripped = JSON.parse(JSON.stringify(action)) as typeof action;
    const afterRoundTrip = reducer(state, roundTripped);
    expect(afterRoundTrip).toEqual(direct);
  });
});
