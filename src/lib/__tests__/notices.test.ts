import { describe, expect, it } from 'vitest';
import { reducer } from '../../store/reducer';
import { ackAllFor, pendingNoticesFor, recipeChanges } from '../notices';
import type { AppState, Product, Recipe } from '../../types';

const recipe: Recipe = {
  id: 'rec-1',
  name: 'קרם ברולה',
  category: 'st-1',
  yieldQty: 8,
  yieldUnit: 'unit',
  producesProductId: 'prod-1',
  items: [{ refType: 'ingredient', refId: 'ing-egg', qty: 4, unit: 'unit' }],
  steps: ['לערבב', 'לאפות'],
};
const product: Product = { id: 'prod-1', name: 'קרם ברולה', kind: 'menu', unit: 'unit', currentQty: 3, weeklyTarget: 40, dailyUsage: 15, recipeId: 'rec-1' };

const state: AppState = {
  schemaVersion: 5,
  settings: { defaultCoverageDays: 1, weekStartsOn: 0, roundMultiplierTo: null },
  cooks: [
    { id: 'chef-cook', name: 'שף', color: '#111' },
    { id: 'cook-a', name: 'דני', color: '#222' },
    { id: 'cook-b', name: 'מאיה', color: '#333' },
  ],
  stations: [],
  ingredients: [{ id: 'ing-egg', name: 'ביצים', unit: 'unit', currentQty: 60, dailyUsage: 20, weeklyUsage: 140 }],
  products: [product],
  recipes: [recipe],
  tasks: [], taskOverrides: [], specialEvents: [], dayPlans: [], orderLines: [],
};

const edit = (s: AppState, patch: Partial<Recipe>, byCookId = 'chef-cook') =>
  reducer(s, { type: 'UPDATE_RECIPE', recipe: { ...recipe, ...patch }, byCookId });

describe('recipeChanges', () => {
  it('names what a cook doing the prep would care about', () => {
    expect(recipeChanges(recipe, { ...recipe, name: 'קרם ברולה וניל' })).toEqual(['name']);
    expect(recipeChanges(recipe, { ...recipe, items: [{ ...recipe.items[0], qty: 5 }] })).toEqual(['items']);
    expect(recipeChanges(recipe, { ...recipe, steps: ['לאפות'] })).toEqual(['steps']);
    expect(recipeChanges(recipe, { ...recipe, yieldQty: 10 })).toEqual(['yield']);
  });

  it('ignores a station move, a re-link and whitespace in the name', () => {
    expect(recipeChanges(recipe, { ...recipe, category: 'st-2' })).toEqual([]);
    expect(recipeChanges(recipe, { ...recipe, producesProductId: undefined })).toEqual([]);
    expect(recipeChanges(recipe, { ...recipe, name: '  קרם ברולה ' })).toEqual([]);
  });
});

describe('a recipe edit leaves a notice for the cooks', () => {
  it('posts one for a content change, already read by the author', () => {
    const next = edit(state, { yieldQty: 10 });
    expect(next.recipeNotices?.['rec-1']).toEqual({ rev: 1, changed: ['yield'], ackedBy: ['chef-cook'] });
    expect(pendingNoticesFor(next, 'cook-a')).toEqual([{ recipeId: 'rec-1', recipeName: 'קרם ברולה', rev: 1, changed: ['yield'] }]);
    expect(pendingNoticesFor(next, 'chef-cook')).toEqual([]);
  });

  it('posts nothing for a station move (AddManualTaskSheet does exactly this)', () => {
    const next = edit(state, { category: 'st-2' });
    expect(next.recipeNotices).toBeUndefined();
  });

  it('posts nothing for a brand-new recipe', () => {
    const fresh = reducer({ ...state, recipes: [] }, { type: 'ADD_RECIPE', recipe });
    expect(fresh.recipeNotices).toBeUndefined();
  });

  it('also fires from the prep-item save the recipe editor uses', () => {
    const next = reducer(state, { type: 'SAVE_PREP_ITEM', recipe: { ...recipe, steps: ['לערבב'] }, product, byCookId: 'chef-cook' });
    expect(next.recipeNotices?.['rec-1'].changed).toEqual(['steps']);
  });

  it('survives the JSON round trip an op takes', () => {
    const action = { type: 'UPDATE_RECIPE', recipe: { ...recipe, yieldQty: 10 }, byCookId: 'chef-cook' } as const;
    expect(reducer(state, JSON.parse(JSON.stringify(action)))).toEqual(reducer(state, action));
  });
});

describe('a second edit before anyone read the first', () => {
  it('bumps the revision and merges what changed', () => {
    const once = edit(state, { yieldQty: 10 });
    const twice = reducer(once, { type: 'UPDATE_RECIPE', recipe: { ...recipe, yieldQty: 10, steps: ['x'] }, byCookId: 'chef-cook' });
    expect(twice.recipeNotices?.['rec-1']).toMatchObject({ rev: 2, changed: ['yield', 'steps'], ackedBy: ['chef-cook'] });
  });

  it('starts the change list afresh once every cook has read the last one', () => {
    let s = edit(state, { yieldQty: 10 });
    for (const cookId of ['cook-a', 'cook-b']) s = reducer(s, { type: 'ACK_RECIPE_NOTICE', recipeId: 'rec-1', rev: 1, cookId });
    const later = reducer(s, { type: 'UPDATE_RECIPE', recipe: { ...recipe, yieldQty: 10, steps: ['x'] }, byCookId: 'chef-cook' });
    expect(later.recipeNotices?.['rec-1'].changed).toEqual(['steps']);
  });
});

describe('ACK_RECIPE_NOTICE', () => {
  const posted = edit(state, { yieldQty: 10 });

  it('clears the notice for that cook only', () => {
    const next = reducer(posted, { type: 'ACK_RECIPE_NOTICE', recipeId: 'rec-1', rev: 1, cookId: 'cook-a' });
    expect(pendingNoticesFor(next, 'cook-a')).toEqual([]);
    expect(pendingNoticesFor(next, 'cook-b')).toHaveLength(1);
  });

  it('is idempotent', () => {
    const once = reducer(posted, { type: 'ACK_RECIPE_NOTICE', recipeId: 'rec-1', rev: 1, cookId: 'cook-a' });
    expect(reducer(once, { type: 'ACK_RECIPE_NOTICE', recipeId: 'rec-1', rev: 1, cookId: 'cook-a' })).toBe(once);
  });

  it('does not clear a newer revision the cook has not read', () => {
    const newer = reducer(posted, { type: 'UPDATE_RECIPE', recipe: { ...recipe, yieldQty: 12 }, byCookId: 'chef-cook' });
    const stale = reducer(newer, { type: 'ACK_RECIPE_NOTICE', recipeId: 'rec-1', rev: 1, cookId: 'cook-a' });
    expect(pendingNoticesFor(stale, 'cook-a')).toHaveLength(1);
  });

  it('ignores an unknown recipe', () => {
    expect(reducer(posted, { type: 'ACK_RECIPE_NOTICE', recipeId: 'nope', rev: 1, cookId: 'cook-a' })).toBe(posted);
  });
});

describe('who is asked', () => {
  it('does not ask about a recipe that was deleted', () => {
    const posted = edit(state, { yieldQty: 10 });
    const gone = reducer(posted, { type: 'DELETE_RECIPE', id: 'rec-1' });
    expect(pendingNoticesFor(gone, 'cook-a')).toEqual([]);
  });

  it('does not ask a cook who joins afterwards to catch up on old changes', () => {
    const posted = edit(state, { yieldQty: 10 });
    const joined = reducer(posted, { type: 'ADD_COOK', cook: { id: 'cook-new', name: 'חדש', color: '#444' } });
    expect(pendingNoticesFor(joined, 'cook-new')).toEqual([]);
    expect(pendingNoticesFor(joined, 'cook-a')).toHaveLength(1);
  });

  it('lists several recipes by name', () => {
    const second: Recipe = { ...recipe, id: 'rec-2', name: 'אורז', producesProductId: undefined };
    const both = { ...state, recipes: [recipe, second] };
    let s = reducer(both, { type: 'UPDATE_RECIPE', recipe: { ...second, yieldQty: 9 }, byCookId: 'chef-cook' });
    s = reducer(s, { type: 'UPDATE_RECIPE', recipe: { ...recipe, yieldQty: 10 }, byCookId: 'chef-cook' });
    expect(pendingNoticesFor(s, 'cook-a').map((n) => n.recipeName)).toEqual(['אורז', 'קרם ברולה']);
  });

  it('ackAllFor is a no-op without notices', () => {
    expect(ackAllFor(state, 'x')).toBe(state);
  });
});
