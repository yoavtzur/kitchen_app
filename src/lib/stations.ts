import { UNASSIGNED_CATEGORY, UNASSIGNED_LABEL } from './recipeCategories';
import type { AppState, Product, Recipe, Station } from '../types';

/** What deleting a station would move, for the confirmation to state in numbers. Recipes carry
 * the station and auto-tasks are derived from their recipe, so "recipes" is also "the prep tasks
 * that disappear from this station's list". */
export function stationImpact(state: AppState, stationId: string): { recipes: number; manualTasks: number } {
  return {
    recipes: state.recipes.filter((r) => r.category === stationId).length,
    manualTasks: state.tasks.filter((t) => !t.done && t.categoryOverride === stationId).length,
  };
}

/** A Hebrew message when `name` can't be used for a station, otherwise null. `exceptId` is the
 * station being renamed, so keeping its own name (or only changing its case) is not a clash.
 * Mirrors what the reducer silently ignores — the UI says why, the reducer stays replay-safe. */
export function stationNameError(name: string, stations: Station[], exceptId?: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'נא להזין שם לפס';
  const clash = stations.some((s) => s.id !== exceptId && s.name.trim().toLowerCase() === trimmed.toLowerCase());
  return clash ? 'כבר קיים פס בשם הזה' : null;
}

/** Which station a prep product belongs to: its recipe's, else the permanent "כללי" bucket. A
 * product has no category of its own — the station lives on the recipe that makes it. */
export function productStation(product: Pick<Product, 'recipeId'>, recipes: Pick<Recipe, 'id' | 'category'>[]): string {
  const recipe = product.recipeId ? recipes.find((r) => r.id === product.recipeId) : undefined;
  return recipe?.category ?? UNASSIGNED_CATEGORY;
}

/**
 * Tabs for counting prep products by station. Like the ingredient tabs, built from what exists:
 * a station with nothing to count is not a tab, and "כללי" appears only when some product has no
 * station. Order follows the kitchen's own station order, with "הכל" first.
 */
export function productStationTabs(
  products: Pick<Product, 'recipeId'>[],
  recipes: Pick<Recipe, 'id' | 'category'>[],
  stations: Station[],
): { value: string; label: string }[] {
  const used = new Set(products.map((p) => productStation(p, recipes)));
  const tabs = [{ value: 'all', label: 'הכל' }];
  for (const s of stations) if (used.has(s.id)) tabs.push({ value: s.id, label: s.name });
  if (used.has(UNASSIGNED_CATEGORY)) tabs.push({ value: UNASSIGNED_CATEGORY, label: UNASSIGNED_LABEL });
  return tabs;
}
