import type { AppState, Priority, RecipeCategory, Station, Task, TaskCompletion } from '../types';
import { multiplierForProduct, priorityFor, toPrepare, weightedRecipeItems } from './calc';
import { stationOptions } from './recipeCategories';

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
  /** Station this task belongs to — the recipe's own category for an auto/recipe-backed task,
   * else the free-text task's categoryOverride, else 'general'. Resolved once here instead of
   * repeated per-screen recipe lookups. */
  category: RecipeCategory;
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
    .map((t: Task) => {
      const recipe = t.recipeId ? state.recipes.find((r) => r.id === t.recipeId) : undefined;
      return {
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
        category: recipe?.category ?? t.categoryOverride ?? 'general',
        note: t.note,
        appliedCompletion: t.appliedCompletion,
      };
    });

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
      category: recipe.category,
      appliedCompletion: override?.appliedCompletion,
      unitMismatch: unitMismatch || undefined,
    });
  }

  return [...auto, ...manual];
}

// ── selectors over a DisplayTask list ────────────────────────────────────────
//
// `getDisplayTasks` returns `[...auto, ...manual]` **unsorted** and ungrouped. These three
// functions are the only place that decides how a task list is counted, ordered and grouped, so
// the screen and the nav badge can never drift into showing two different numbers for the same
// day. They are pure and read no wall clock, which is what makes them testable and makes every
// device agree.

export type TaskProgress = {
  total: number;
  done: number;
  open: number;
  /** 0..1. **Exactly 1 when `total === 0`** — "nothing to do" should read as complete, not as
   * 0%, which is what a naive `done / total` would show (or NaN). */
  ratio: number;
  /** Open tasks at red priority: the number worth calling out separately from the total. */
  urgent: number;
};

export function taskProgress(tasks: readonly DisplayTask[]): TaskProgress {
  const total = tasks.length;
  const done = tasks.reduce((n, t) => n + (t.done ? 1 : 0), 0);
  const urgent = tasks.reduce((n, t) => n + (!t.done && t.priority === 'red' ? 1 : 0), 0);
  return { total, done, open: total - done, ratio: total === 0 ? 1 : done / total, urgent };
}

const PRIORITY_ORDER: Record<Priority, number> = { red: 0, yellow: 1, green: 2 };

/**
 * Open tasks first, then by priority, then stably by id.
 *
 * Done tasks sinking to the bottom is the point: a cook working down the screen should never
 * have to skip over something already finished. The final id tiebreak keeps the order identical
 * across devices and across renders — without it, two tasks of equal priority could swap places
 * whenever `getDisplayTasks` rebuilt the array in a different order.
 */
export function sortDisplayTasks(tasks: readonly DisplayTask[]): DisplayTask[] {
  return [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const byPriority = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (byPriority !== 0) return byPriority;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Groups tasks by station, in the kitchen's own station order, dropping empty groups.
 *
 * This is Home's exact behavior, now shared and tested rather than living inline in one screen.
 * Each group's tasks are sorted by the same rule as the flat list, so a station heading never
 * reorders what is underneath it relative to the ungrouped view.
 */
export function groupByStation(
  tasks: readonly DisplayTask[],
  stations: Station[] | undefined | null,
): { value: string; label: string; tasks: DisplayTask[] }[] {
  return stationOptions(stations)
    .map((station) => ({
      ...station,
      tasks: sortDisplayTasks(tasks.filter((t) => t.category === station.value)),
    }))
    .filter((group) => group.tasks.length > 0);
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
