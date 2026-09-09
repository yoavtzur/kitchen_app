import { describe, expect, it } from 'vitest';
import {
  describeImpact,
  impactOfDeletingIngredient,
  impactOfDeletingProduct,
  impactOfDeletingRecipe,
  pruneEntities,
  resolveDeletion,
} from '../integrity';
import type { AppState } from '../../types';

/**
 * A pizza that consumes prepared dough, so deletes have something to cascade through:
 * dough (recipe+product) is an ingredient line inside the pizza recipe.
 */
function baseState(overrides: Partial<AppState> = {}): AppState {
  return {
    schemaVersion: 3,
    settings: { defaultCoverageDays: 1, weekStartsOn: 0, roundMultiplierTo: 0.25 },
    cooks: [],
    ingredients: [
      { id: 'ing-flour', name: 'קמח', unit: 'kg', currentQty: 10, dailyUsage: 2, weeklyUsage: 14 },
      { id: 'ing-tomato', name: 'עגבניות', unit: 'kg', currentQty: 4, dailyUsage: 1, weeklyUsage: 7 },
    ],
    products: [
      {
        id: 'prod-dough',
        name: 'בצק',
        kind: 'component',
        unit: 'unit',
        currentQty: 6,
        weeklyTarget: 84,
        dailyUsage: 12,
        recipeId: 'recipe-dough',
      },
      {
        id: 'prod-pizza',
        name: 'פיצה',
        kind: 'menu',
        unit: 'unit',
        currentQty: 2,
        weeklyTarget: 70,
        dailyUsage: 10,
        recipeId: 'recipe-pizza',
      },
    ],
    recipes: [
      {
        id: 'recipe-dough',
        name: 'בצק',
        category: 'taboon',
        yieldQty: 6,
        yieldUnit: 'unit',
        producesProductId: 'prod-dough',
        items: [{ refType: 'ingredient', refId: 'ing-flour', qty: 1, unit: 'kg' }],
        steps: [],
      },
      {
        id: 'recipe-pizza',
        name: 'פיצה',
        category: 'taboon',
        yieldQty: 1,
        yieldUnit: 'unit',
        producesProductId: 'prod-pizza',
        items: [
          { refType: 'product', refId: 'prod-dough', qty: 1, unit: 'unit' },
          { refType: 'ingredient', refId: 'ing-tomato', qty: 0.2, unit: 'kg' },
        ],
        steps: [],
      },
    ],
    tasks: [
      {
        id: 'task-1',
        date: '2026-09-05',
        recipeId: 'recipe-dough',
        multiplier: 2,
        priority: 'red',
        done: false,
        source: 'manual',
      },
    ],
    taskOverrides: [
      { id: 'auto-prod-dough-2026-09-05', productId: 'prod-dough', date: '2026-09-05', dismissed: true },
    ],
    specialEvents: [
      { id: 'ev-1', name: 'אירוע', date: '2026-09-06', extras: [{ productId: 'prod-dough', extraQty: 20 }] },
    ],
    dayPlans: [{ date: '2026-09-05', entries: [{ productId: 'prod-dough', prepOverride: 30 }] }],
    orderLines: [{ ingredientId: 'ing-flour', date: '2026-09-05', ordered: true }],
    ...overrides,
  };
}

describe('resolveDeletion follows the recipe⇄product link', () => {
  it('deleting a recipe pulls in the product it produces', () => {
    const closure = resolveDeletion(baseState(), { recipeIds: ['recipe-dough'] });
    expect([...closure.productIds]).toEqual(['prod-dough']);
  });

  it('deleting a product pulls in its recipe', () => {
    const closure = resolveDeletion(baseState(), { productIds: ['prod-dough'] });
    expect([...closure.recipeIds]).toEqual(['recipe-dough']);
  });

  it('does not pull recipes or products in when only an ingredient is deleted', () => {
    const closure = resolveDeletion(baseState(), { ingredientIds: ['ing-flour'] });
    expect(closure.recipeIds.size).toBe(0);
    expect(closure.productIds.size).toBe(0);
  });
});

describe('impactOfDeleting*', () => {
  it('reports every place a prep item is referenced', () => {
    const impact = impactOfDeletingRecipe('recipe-dough', baseState());
    expect(impact.products.map((p) => p.id)).toEqual(['prod-dough']);
    expect(impact.recipes.map((r) => r.id)).toEqual(['recipe-dough']);
    expect(impact.usedInRecipes.map((r) => r.id)).toEqual(['recipe-pizza']);
    expect(impact.manualTasks.map((t) => t.id)).toEqual(['task-1']);
    expect(impact.dayPlanDates).toEqual(['2026-09-05']);
    expect(impact.events.map((e) => e.id)).toEqual(['ev-1']);
  });

  it('reaches the same conclusion from the product side', () => {
    const fromProduct = impactOfDeletingProduct('prod-dough', baseState());
    expect(fromProduct.recipes.map((r) => r.id)).toEqual(['recipe-dough']);
    expect(fromProduct.usedInRecipes.map((r) => r.id)).toEqual(['recipe-pizza']);
  });

  it('reports the recipes an ingredient would be stripped from', () => {
    const impact = impactOfDeletingIngredient('ing-flour', baseState());
    expect(impact.products).toEqual([]);
    expect(impact.usedInRecipes.map((r) => r.id)).toEqual(['recipe-dough']);
  });

  it('describes an unreferenced item as safe to delete', () => {
    const state = baseState({ tasks: [], taskOverrides: [], specialEvents: [], dayPlans: [] });
    const impact = impactOfDeletingIngredient('ing-tomato', {
      ...state,
      recipes: state.recipes.filter((r) => r.id === 'recipe-dough'),
    });
    expect(describeImpact(impact)).toEqual(['לא מקושר לשום דבר אחר באפליקציה.']);
  });
});

describe('pruneEntities removes every trace', () => {
  it('deleting a recipe removes its product and all references to it', () => {
    const next = pruneEntities(baseState(), { recipeIds: ['recipe-dough'] });

    expect(next.recipes.map((r) => r.id)).toEqual(['recipe-pizza']);
    expect(next.products.map((p) => p.id)).toEqual(['prod-pizza']);
    // the pizza recipe keeps its tomato line but loses the deleted dough line
    expect(next.recipes[0].items).toEqual([
      { refType: 'ingredient', refId: 'ing-tomato', qty: 0.2, unit: 'kg' },
    ]);
    expect(next.tasks).toEqual([]);
    expect(next.taskOverrides).toEqual([]);
    expect(next.dayPlans).toEqual([]);
    expect(next.specialEvents).toEqual([]);
  });

  it('deleting an ingredient strips it from recipes and from the order sheet', () => {
    const next = pruneEntities(baseState(), { ingredientIds: ['ing-flour'] });

    expect(next.ingredients.map((i) => i.id)).toEqual(['ing-tomato']);
    expect(next.recipes.find((r) => r.id === 'recipe-dough')?.items).toEqual([]);
    expect(next.orderLines).toEqual([]);
    // products and their links are untouched by an ingredient delete
    expect(next.products).toHaveLength(2);
  });

  it('deletes only the item asked for — a consumed sub-item survives intact', () => {
    // Deleting the pizza must not take the dough down with it, even though the pizza
    // recipe consumes it: the cascade follows the produces-link, not the consumes-link.
    const next = pruneEntities(baseState(), { recipeIds: ['recipe-pizza'] });

    expect(next.recipes.map((r) => r.id)).toEqual(['recipe-dough']);
    expect(next.products.map((p) => p.id)).toEqual(['prod-dough']);
    expect(next.recipes[0].items).toHaveLength(1);
    // references that belong to the dough, not the pizza, are left alone
    expect(next.tasks).toHaveLength(1);
    expect(next.dayPlans).toHaveLength(1);
    expect(next.specialEvents).toHaveLength(1);
  });
});
