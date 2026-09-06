import { describe, expect, it } from 'vitest';
import {
  daysOfSupply,
  explodeIngredients,
  multiplierForProduct,
  orderQtyForIngredient,
  priorityFor,
  recipeMultiplier,
  requiredQty,
  toPrepare,
  weekdayValue,
  weeklyNeedForIngredient,
} from '../calc';
import type { AppState, Product, Recipe } from '../../types';

function baseState(overrides: Partial<AppState> = {}): AppState {
  return {
    schemaVersion: 1,
    settings: { defaultCoverageDays: 1, weekStartsOn: 0, roundMultiplierTo: 0.25 },
    cooks: [],
    ingredients: [
      { id: 'ing-tomato', name: 'עגבניות', unit: 'kg', currentQty: 4, dailyUsage: 1, weeklyUsage: 0 },
    ],
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

describe('toPrepare', () => {
  it('matches the kitchen example: daily 15, current 3 -> 12 to prepare', () => {
    const state = baseState({ products: [cremeBrulee] });
    expect(toPrepare(cremeBrulee, '2026-09-05', state)).toBe(12);
  });

  it('respects a manual prepOverride for the day', () => {
    const state = baseState({
      products: [cremeBrulee],
      dayPlans: [{ date: '2026-09-05', entries: [{ productId: cremeBrulee.id, prepOverride: 20 }] }],
    });
    expect(toPrepare(cremeBrulee, '2026-09-05', state)).toBe(20);
  });

  it('adds special-event extras to the required quantity', () => {
    const state = baseState({
      products: [cremeBrulee],
      specialEvents: [
        { id: 'ev-1', name: 'חתונה', date: '2026-09-05', extras: [{ productId: cremeBrulee.id, extraQty: 10 }] },
      ],
    });
    // required = 15 + 10 = 25, coverageDays = 1, current = 3 -> 22
    expect(toPrepare(cremeBrulee, '2026-09-05', state)).toBe(22);
  });
});

describe('recipeMultiplier', () => {
  it('computes 1.5x for a 1L yield recipe needing 1.5L', () => {
    const salsaRecipe: Recipe = {
      id: 'recipe-salsa',
      name: 'סלסת עגבניות',
      category: 'cold',
      yieldQty: 1,
      yieldUnit: 'l',
      items: [],
      steps: [],
    };
    expect(recipeMultiplier(salsaRecipe, 1.5, null)).toBe(1.5);
  });

  it('rounds up to the nearest roundTo step', () => {
    const r: Recipe = { id: 'r', name: 'r', category: 'general', yieldQty: 8, yieldUnit: 'unit', items: [], steps: [] };
    // needs 12/8 = 1.5 -> already aligned to 0.25 step
    expect(recipeMultiplier(r, 12, 0.25)).toBe(1.5);
    // needs 10/8 = 1.25 -> aligned
    expect(recipeMultiplier(r, 10, 0.25)).toBe(1.25);
  });
});

describe('priorityFor', () => {
  it('is red when current is below the daily requirement', () => {
    const state = baseState({ products: [cremeBrulee] });
    expect(priorityFor(cremeBrulee, '2026-09-05', state)).toBe('red');
  });

  it('is green when current covers required * coverageDays', () => {
    const wellStocked: Product = { ...cremeBrulee, currentQty: 30 };
    const state = baseState({ products: [wellStocked] });
    expect(priorityFor(wellStocked, '2026-09-05', state)).toBe('green');
  });
});

describe('explodeIngredients', () => {
  it('scales ingredient quantities by the multiplier', () => {
    const state = baseState({
      ingredients: [{ id: 'ing-tomato', name: 'עגבניות', unit: 'kg', currentQty: 4, dailyUsage: 1, weeklyUsage: 0 }],
      products: [],
      recipes: [],
    });
    const recipe: Recipe = {
      id: 'r',
      name: 'סלסה',
      category: 'cold',
      yieldQty: 1,
      yieldUnit: 'l',
      items: [{ refType: 'ingredient', refId: 'ing-tomato', qty: 1, unit: 'kg' }],
      steps: [],
    };
    const lines = explodeIngredients(recipe, 1.5, state);
    expect(lines).toEqual([
      { refType: 'ingredient', refId: 'ing-tomato', name: 'עגבניות', qty: 1.5, unit: 'kg', unresolvedUnit: false },
    ]);
  });

  it('recursively expands a component product that has its own recipe', () => {
    const doughIngredient = { id: 'ing-flour', name: 'קמח', unit: 'kg' as const, currentQty: 10, dailyUsage: 1, weeklyUsage: 0 };
    const doughProduct: Product = {
      id: 'prod-dough',
      name: 'בצק',
      kind: 'component',
      unit: 'unit',
      currentQty: 0,
      weeklyTarget: 0,
      dailyUsage: 0,
      recipeId: 'recipe-dough',
    };
    const doughRecipe: Recipe = {
      id: 'recipe-dough',
      name: 'בצק',
      category: 'taboon',
      yieldQty: 6,
      yieldUnit: 'unit',
      items: [{ refType: 'ingredient', refId: 'ing-flour', qty: 1, unit: 'kg' }],
      steps: [],
    };
    const pizzaRecipe: Recipe = {
      id: 'recipe-pizza',
      name: 'פיצה',
      category: 'taboon',
      yieldQty: 1,
      yieldUnit: 'unit',
      items: [{ refType: 'product', refId: 'prod-dough', qty: 1, unit: 'unit' }],
      steps: [],
    };
    const state = baseState({
      ingredients: [doughIngredient],
      products: [doughProduct],
      recipes: [doughRecipe, pizzaRecipe],
    });
    // 3 pizzas need 3 dough units -> 3/6 = 0.5x dough recipe -> 0.5kg flour
    const lines = explodeIngredients(pizzaRecipe, 3, state);
    expect(lines).toEqual([
      { refType: 'ingredient', refId: 'ing-flour', name: 'קמח', qty: 0.5, unit: 'kg', unresolvedUnit: false },
    ]);
  });

  it('does not infinite-loop on a self-referencing recipe cycle', () => {
    const cyclicProduct: Product = {
      id: 'prod-cycle',
      name: 'cycle',
      kind: 'component',
      unit: 'unit',
      currentQty: 0,
      weeklyTarget: 0,
      dailyUsage: 0,
      recipeId: 'recipe-cycle',
    };
    const cyclicRecipe: Recipe = {
      id: 'recipe-cycle',
      name: 'cycle',
      category: 'general',
      yieldQty: 1,
      yieldUnit: 'unit',
      items: [{ refType: 'product', refId: 'prod-cycle', qty: 1, unit: 'unit' }],
      steps: [],
    };
    const state = baseState({ products: [cyclicProduct], recipes: [cyclicRecipe] });
    expect(() => explodeIngredients(cyclicRecipe, 1, state)).not.toThrow();
  });
});

describe('weeklyNeedForIngredient / orderQtyForIngredient', () => {
  it('derives weekly need from product weeklyTarget when ingredient weeklyUsage is unset', () => {
    const state = baseState({
      ingredients: [{ id: 'ing-tomato', name: 'עגבניות', unit: 'kg', currentQty: 4, dailyUsage: 1, weeklyUsage: 0 }],
      products: [{ ...cremeBrulee, weeklyTarget: 8, recipeId: 'recipe-salsa' }],
      recipes: [
        {
          id: 'recipe-salsa',
          name: 'סלסה',
          category: 'cold',
          yieldQty: 1,
          yieldUnit: 'unit',
          items: [{ refType: 'ingredient', refId: 'ing-tomato', qty: 1, unit: 'kg' }],
          steps: [],
        },
      ],
    });
    // weeklyTarget 8 units, recipe yields 1 unit per 1kg tomato -> need 8kg
    expect(weeklyNeedForIngredient('ing-tomato', state)).toBe(8);
    expect(orderQtyForIngredient('ing-tomato', state)).toBe(4); // 8 - current(4)
  });
});

describe('daysOfSupply', () => {
  it('returns Infinity when dailyUsage is 0', () => {
    expect(daysOfSupply({ currentQty: 5, dailyUsage: 0 })).toBe(Infinity);
  });

  it('divides current by daily usage', () => {
    expect(daysOfSupply({ currentQty: 10, dailyUsage: 4 })).toBe(2.5);
  });
});

describe('requiredQty', () => {
  it('falls back to dailyUsage with no day plan or events', () => {
    expect(requiredQty(cremeBrulee, '2026-09-05', [], [])).toBe(15);
  });
});

describe('multiplierForProduct converts between stock and yield units', () => {
  const kgProduct: Product = {
    id: 'prod-cream',
    name: 'קרם',
    kind: 'component',
    unit: 'kg',
    currentQty: 0,
    weeklyTarget: 0,
    dailyUsage: 0,
  };

  const gramRecipe: Recipe = {
    id: 'recipe-cream',
    name: 'קרם',
    category: 'cold',
    yieldQty: 500,
    yieldUnit: 'g',
    items: [],
    steps: [],
  };

  it('scales a kg requirement against a recipe that yields grams', () => {
    // 2kg needed, batch makes 500g -> 4 batches (not 2/500 = 0.004)
    expect(multiplierForProduct(kgProduct, gramRecipe, 2, null)).toEqual({
      multiplier: 4,
      unitMismatch: false,
    });
  });

  it('still rounds the converted multiplier', () => {
    // 1.1kg = 1100g / 500 = 2.2 -> rounded up to the next quarter
    expect(multiplierForProduct(kgProduct, gramRecipe, 1.1, 0.25).multiplier).toBe(2.25);
  });

  it('flags a mismatch instead of inventing a number for unrelated units', () => {
    const pieceRecipe: Recipe = { ...gramRecipe, yieldQty: 1, yieldUnit: 'unit' };
    expect(multiplierForProduct(kgProduct, pieceRecipe, 3, null)).toEqual({
      multiplier: 0,
      unitMismatch: true,
    });
  });

  it('behaves like a plain division when both units match', () => {
    const kgRecipe: Recipe = { ...gramRecipe, yieldQty: 2, yieldUnit: 'kg' };
    expect(multiplierForProduct(kgProduct, kgRecipe, 6, null).multiplier).toBe(3);
  });
});

describe('weekly need and order quantities across units', () => {
  function crossUnitState(): AppState {
    return baseState({
      ingredients: [
        { id: 'ing-flour', name: 'קמח', unit: 'kg', currentQty: 1, dailyUsage: 1, weeklyUsage: 0, parLevel: 6 },
      ],
      products: [
        {
          id: 'prod-cream',
          name: 'קרם',
          kind: 'component',
          unit: 'kg',
          currentQty: 0,
          weeklyTarget: 2,
          dailyUsage: 0,
          recipeId: 'recipe-cream',
        },
      ],
      recipes: [
        {
          id: 'recipe-cream',
          name: 'קרם',
          category: 'cold',
          yieldQty: 500,
          yieldUnit: 'g',
          producesProductId: 'prod-cream',
          items: [{ refType: 'ingredient', refId: 'ing-flour', qty: 1, unit: 'kg' }],
          steps: [],
        },
      ],
    });
  }

  it('converts a weekly target in kg against a recipe yielding grams', () => {
    // 2kg target / 500g batch = 4 batches x 1kg flour = 4kg
    expect(weeklyNeedForIngredient('ing-flour', crossUnitState())).toBe(4);
  });

  it('tops the order up to the par level when it exceeds the weekly need', () => {
    // need 4kg vs par 6kg -> order to par, minus the 1kg on hand
    expect(orderQtyForIngredient('ing-flour', crossUnitState())).toBe(5);
  });
});

describe('explodeIngredients across a sub-recipe in another unit', () => {
  it('converts the item quantity into the sub-recipe yield unit before recursing', () => {
    const state = baseState({
      ingredients: [
        { id: 'ing-flour', name: 'קמח', unit: 'kg', currentQty: 0, dailyUsage: 0, weeklyUsage: 0 },
      ],
      products: [
        {
          id: 'prod-dough',
          name: 'בצק',
          kind: 'component',
          unit: 'kg',
          currentQty: 0,
          weeklyTarget: 0,
          dailyUsage: 0,
          recipeId: 'recipe-dough',
        },
      ],
      recipes: [
        {
          id: 'recipe-dough',
          name: 'בצק',
          category: 'taboon',
          yieldQty: 500,
          yieldUnit: 'g',
          producesProductId: 'prod-dough',
          items: [{ refType: 'ingredient', refId: 'ing-flour', qty: 1, unit: 'kg' }],
          steps: [],
        },
      ],
    });

    const pizza: Recipe = {
      id: 'recipe-pizza',
      name: 'פיצה',
      category: 'taboon',
      yieldQty: 1,
      yieldUnit: 'unit',
      items: [{ refType: 'product', refId: 'prod-dough', qty: 2, unit: 'kg' }],
      steps: [],
    };

    // 2kg of dough = 2000g / 500g per batch = 4 batches -> 4kg flour
    const lines = explodeIngredients(pizza, 1, state);
    expect(lines).toEqual([
      { refType: 'ingredient', refId: 'ing-flour', name: 'קמח', qty: 4, unit: 'kg', unresolvedUnit: false },
    ]);
  });
});

describe('weekdayValue resolves a per-weekday override', () => {
  const friday = '2026-09-04'; // Friday
  const monday = '2026-08-31'; // Monday

  it('falls back to the base value when there is no override map', () => {
    expect(weekdayValue(10, undefined, friday)).toBe(10);
  });

  it('falls back to the base value when this weekday has no entry', () => {
    expect(weekdayValue(10, { 1: 25 }, friday)).toBe(10); // 1 = Monday, we're asking about Friday
  });

  it('uses the override for the date’s weekday', () => {
    expect(weekdayValue(10, { 5: 25 }, friday)).toBe(25); // 5 = Friday
    expect(weekdayValue(10, { 5: 25 }, monday)).toBe(10);
  });
});

describe('requiredQty honours a per-weekday dailyUsage override', () => {
  it('uses the override for that date instead of the base dailyUsage', () => {
    const busyFriday: Product = { ...cremeBrulee, dailyUsageByWeekday: { 5: 40 } };
    expect(requiredQty(busyFriday, '2026-09-04', [], [])).toBe(40); // Friday
    expect(requiredQty(busyFriday, '2026-09-05', [], [])).toBe(15); // Saturday -> base
  });

  it('still adds special-event extras on top of the overridden value', () => {
    const busyFriday: Product = { ...cremeBrulee, dailyUsageByWeekday: { 5: 40 } };
    const events = [{ id: 'ev', name: 'x', date: '2026-09-04', extras: [{ productId: cremeBrulee.id, extraQty: 5 }] }];
    expect(requiredQty(busyFriday, '2026-09-04', [], events)).toBe(45);
  });
});

describe('daysOfSupply resolves weekday usage only when a date is given', () => {
  it('uses the base dailyUsage when no date is passed (unchanged behaviour)', () => {
    const ing = { currentQty: 40, dailyUsage: 10, dailyUsageByWeekday: { 5: 40 } };
    expect(daysOfSupply(ing)).toBe(4);
  });

  it('uses the weekday override for the given date', () => {
    const ing = { currentQty: 40, dailyUsage: 10, dailyUsageByWeekday: { 5: 40 } };
    expect(daysOfSupply(ing, '2026-09-04')).toBe(1); // Friday override -> 40/40
    expect(daysOfSupply(ing, '2026-09-05')).toBe(4); // Saturday -> base 10
  });
});
