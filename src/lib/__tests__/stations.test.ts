import { describe, expect, it } from 'vitest';
import { productStation, productStationTabs, stationImpact, stationNameError } from '../stations';
import type { AppState, Recipe, Station, Task } from '../../types';

const hot: Station = { id: 'hot', name: 'פס חם', createdAt: '2026-09-05' };
const cold: Station = { id: 'cold', name: 'פס קר', createdAt: '2026-09-05' };

const recipe = (id: string, category: string): Recipe => ({
  id,
  name: id,
  category,
  yieldQty: 1,
  yieldUnit: 'unit',
  items: [],
  steps: [],
});

const task = (id: string, categoryOverride: string | undefined, done = false): Task => ({
  id,
  date: '2026-09-05',
  title: id,
  multiplier: 1,
  priority: 'yellow',
  done,
  source: 'manual',
  categoryOverride,
});

describe('stationImpact', () => {
  const state = {
    recipes: [recipe('a', 'hot'), recipe('b', 'hot'), recipe('c', 'cold')],
    tasks: [task('t1', 'hot'), task('t2', 'hot', true), task('t3', 'cold'), task('t4', undefined)],
  } as unknown as AppState;

  it('counts recipes of the station', () => {
    expect(stationImpact(state, 'hot').recipes).toBe(2);
  });

  it('counts only open free-text tasks — done ones are history, not work to move', () => {
    expect(stationImpact(state, 'hot').manualTasks).toBe(1);
  });

  it('is zero for a station nothing points at', () => {
    expect(stationImpact(state, 'nope')).toEqual({ recipes: 0, manualTasks: 0 });
  });
});

describe('stationNameError', () => {
  it('rejects a blank name', () => {
    expect(stationNameError('   ', [hot])).not.toBeNull();
  });

  it('rejects a clash, ignoring case and surrounding spaces', () => {
    expect(stationNameError('  פס חם ', [hot, cold])).not.toBeNull();
  });

  it('accepts a new name', () => {
    expect(stationNameError('גריל', [hot, cold])).toBeNull();
  });

  it('lets a station keep its own name when renaming', () => {
    expect(stationNameError('פס חם', [hot, cold], 'hot')).toBeNull();
  });

  it('still rejects renaming onto a different station\'s name', () => {
    expect(stationNameError('פס קר', [hot, cold], 'hot')).not.toBeNull();
  });
});

describe('productStation / productStationTabs', () => {
  const recipes = [recipe('r-hot', 'hot'), recipe('r-cold', 'cold')];
  const products = [{ recipeId: 'r-hot' }, { recipeId: 'r-hot' }, { recipeId: undefined }, { recipeId: 'r-missing' }];

  it('takes a product’s station from its recipe, else "general"', () => {
    expect(productStation({ recipeId: 'r-cold' }, recipes)).toBe('cold');
    expect(productStation({ recipeId: undefined }, recipes)).toBe('general');
    expect(productStation({ recipeId: 'r-missing' }, recipes)).toBe('general');
  });

  it('lists only stations that have a product, in kitchen order, then "כללי" if needed', () => {
    const tabs = productStationTabs(products, recipes, [cold, hot]);
    expect(tabs.map((t) => t.value)).toEqual(['all', 'hot', 'general']);
  });

  it('omits "כללי" when every product has a station', () => {
    const tabs = productStationTabs([{ recipeId: 'r-cold' }], recipes, [cold, hot]);
    expect(tabs.map((t) => t.value)).toEqual(['all', 'cold']);
  });
});
