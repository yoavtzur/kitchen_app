import type { AppState, Priority, Task, TaskCompletion } from '../types';
import { multiplierForProduct, priorityFor, toPrepare, weightedRecipeItems } from './calc';

export type DisplayTask = {
  id: string;
  date: string;
  recipeId?: string;
  title?: string;
  productId?: string;
  multiplier: number;
  priority: Priority;
  priorityManual?: boolean;
  assigneeId?: string;
  done: boolean;
  source: 'auto' | 'manual';
  note?: string;
  appliedCompletion?: TaskCompletion;
  /** The product's stock unit cannot be converted to the recipe's yield unit — the
   * multiplier is meaningless until the user fixes one of the two units. */
  unitMismatch?: boolean;
};

export function autoTaskId(productId: string, date: string): string {
  return `auto-${productId}-${date}`;
}

/** Merges manual tasks (stored as-is) with auto tasks (computed live from current stock/recipes/settings,
 * with any stored override for done/priority/assignee/dismissed/appliedCompletion applied on top). */
export function getDisplayTasks(date: string, state: AppState): DisplayTask[] {
  const manual: DisplayTask[] = state.tasks
    .filter((t) => t.date === date)
    .map((t: Task) => ({
      id: t.id,
      date: t.date,
      recipeId: t.recipeId,
      title: t.title,
      multiplier: t.multiplier,
      priority: t.priority,
      priorityManual: t.priorityManual,
      assigneeId: t.assigneeId,
      done: t.done,
      source: 'manual',
      note: t.note,
      appliedCompletion: t.appliedCompletion,
    }));

  const auto: DisplayTask[] = [];
  for (const product of state.products) {
    if (!product.recipeId) continue;
    const recipe = state.recipes.find((r) => r.id === product.recipeId);
    if (!recipe) continue;

    const id = autoTaskId(product.id, date);
    const override = state.taskOverrides.find((o) => o.id === id);
    if (override?.dismissed) continue;

    const qtyNeeded = toPrepare(product, date, state);
    const { multiplier, unitMismatch } = multiplierForProduct(
      product,
      recipe,
      qtyNeeded,
      state.settings.roundMultiplierTo,
    );
    // Keep a done task visible even if the product is now fully stocked again, and always
    // surface a unit mismatch — its 0 multiplier is a data problem, not "nothing to do".
    if (multiplier <= 0 && !override?.done && !unitMismatch) continue;

    auto.push({
      id,
      date,
      recipeId: recipe.id,
      productId: product.id,
      multiplier,
      priority: override?.priorityManual && override.priority ? override.priority : priorityFor(product, date, state),
      priorityManual: override?.priorityManual,
      assigneeId: override?.assigneeId,
      done: override?.done ?? false,
      source: 'auto',
      appliedCompletion: override?.appliedCompletion,
      unitMismatch: unitMismatch || undefined,
    });
  }

  return [...auto, ...manual];
}

/** Ingredient deltas (positive quantities to deduct) for completing `recipe` at `multiplier`. */
export function ingredientDeltasFor(
  recipe: Parameters<typeof weightedRecipeItems>[0],
  multiplier: number,
  state: Parameters<typeof weightedRecipeItems>[2],
): { id: string; delta: number }[] {
  return weightedRecipeItems(recipe, multiplier, state)
    .filter((l) => l.refType === 'ingredient')
    .map((l) => ({ id: l.refId, delta: l.qty }));
}
