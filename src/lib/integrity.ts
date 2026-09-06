import type { AppState, Recipe, Product, SpecialEvent, Task } from '../types';

/** The entities a delete resolves to, once the recipe⇄product link is followed. */
export type DeletionClosure = {
  recipeIds: Set<string>;
  productIds: Set<string>;
  ingredientIds: Set<string>;
};

export type DeletionSeed = {
  recipeIds?: string[];
  productIds?: string[];
  ingredientIds?: string[];
};

/**
 * Expands a delete request across the recipe⇄product link: a prep item is one thing to the
 * user, so deleting either half deletes the other. Iterates to a fixpoint because each half
 * can pull in the other (sets are tiny, so the cost is irrelevant).
 */
export function resolveDeletion(state: AppState, seed: DeletionSeed): DeletionClosure {
  const recipeIds = new Set(seed.recipeIds ?? []);
  const productIds = new Set(seed.productIds ?? []);
  const ingredientIds = new Set(seed.ingredientIds ?? []);

  let changed = true;
  while (changed) {
    changed = false;

    for (const recipeId of recipeIds) {
      const recipe = state.recipes.find((r) => r.id === recipeId);
      if (recipe?.producesProductId && !productIds.has(recipe.producesProductId)) {
        productIds.add(recipe.producesProductId);
        changed = true;
      }
      for (const product of state.products) {
        if (product.recipeId === recipeId && !productIds.has(product.id)) {
          productIds.add(product.id);
          changed = true;
        }
      }
    }

    for (const productId of productIds) {
      const product = state.products.find((p) => p.id === productId);
      if (product?.recipeId && !recipeIds.has(product.recipeId)) {
        recipeIds.add(product.recipeId);
        changed = true;
      }
      for (const recipe of state.recipes) {
        if (recipe.producesProductId === productId && !recipeIds.has(recipe.id)) {
          recipeIds.add(recipe.id);
          changed = true;
        }
      }
    }
  }

  return { recipeIds, productIds, ingredientIds };
}

/** Everything that a delete would remove or edit, for the confirmation dialog. */
export type Impact = {
  /** Prep-item halves that disappear entirely. */
  products: Product[];
  recipes: Recipe[];
  /** Surviving recipes that merely lose an ingredient/product line. */
  usedInRecipes: Recipe[];
  manualTasks: Task[];
  dayPlanDates: string[];
  events: SpecialEvent[];
};

function impactOf(state: AppState, seed: DeletionSeed): Impact {
  const { recipeIds, productIds, ingredientIds } = resolveDeletion(state, seed);

  const usedInRecipes = state.recipes.filter(
    (r) =>
      !recipeIds.has(r.id) &&
      r.items.some((item) =>
        item.refType === 'ingredient' ? ingredientIds.has(item.refId) : productIds.has(item.refId),
      ),
  );

  return {
    products: state.products.filter((p) => productIds.has(p.id)),
    recipes: state.recipes.filter((r) => recipeIds.has(r.id)),
    usedInRecipes,
    manualTasks: state.tasks.filter((t) => t.recipeId !== undefined && recipeIds.has(t.recipeId)),
    dayPlanDates: state.dayPlans
      .filter((plan) => plan.entries.some((e) => productIds.has(e.productId)))
      .map((plan) => plan.date),
    events: state.specialEvents.filter((ev) => ev.extras.some((ex) => productIds.has(ex.productId))),
  };
}

export function impactOfDeletingRecipe(recipeId: string, state: AppState): Impact {
  return impactOf(state, { recipeIds: [recipeId] });
}

export function impactOfDeletingProduct(productId: string, state: AppState): Impact {
  return impactOf(state, { productIds: [productId] });
}

export function impactOfDeletingIngredient(ingredientId: string, state: AppState): Impact {
  return impactOf(state, { ingredientIds: [ingredientId] });
}

function nameList(names: string[], max = 3): string {
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} ועוד ${names.length - max}`;
}

/** Hebrew lines describing an impact, for the delete confirmation dialog. */
export function describeImpact(impact: Impact): string[] {
  const lines: string[] = [];

  if (impact.products.length > 0) {
    lines.push(
      `יימחק מהמסך הראשי ומהצריכה השבועית: ${nameList(impact.products.map((p) => p.name))}`,
    );
  }
  if (impact.usedInRecipes.length > 0) {
    lines.push(
      impact.usedInRecipes.length === 1
        ? `יוסר כרכיב מהמתכון: ${impact.usedInRecipes[0].name}`
        : `יוסר כרכיב מ-${impact.usedInRecipes.length} מתכונים: ${nameList(impact.usedInRecipes.map((r) => r.name))}`,
    );
  }
  if (impact.manualTasks.length > 0) {
    lines.push(
      impact.manualTasks.length === 1
        ? 'תימחק משימה ידנית אחת'
        : `יימחקו ${impact.manualTasks.length} משימות ידניות`,
    );
  }
  if (impact.dayPlanDates.length > 0) {
    lines.push(
      impact.dayPlanDates.length === 1
        ? 'תוסר שורה מתוכנית הצריכה של יום אחד'
        : `יוסרו שורות מתוכנית הצריכה של ${impact.dayPlanDates.length} ימים`,
    );
  }
  if (impact.events.length > 0) {
    lines.push(`תוסר תוספת מהאירועים: ${nameList(impact.events.map((e) => e.name))}`);
  }

  if (lines.length === 0) lines.push('לא מקושר לשום דבר אחר באפליקציה.');
  return lines;
}

/**
 * Applies a resolved deletion to the whole state: removes the entities themselves and every
 * reference to them (recipe lines, day plans, events, task overrides, manual tasks, order rows).
 * This is the one place deletion cleanup lives — all three DELETE_* actions route through it.
 */
export function pruneEntities(state: AppState, seed: DeletionSeed): AppState {
  const { recipeIds, productIds, ingredientIds } = resolveDeletion(state, seed);

  const recipes = state.recipes
    .filter((r) => !recipeIds.has(r.id))
    .map((r) => {
      const items = r.items.filter((item) =>
        item.refType === 'ingredient' ? !ingredientIds.has(item.refId) : !productIds.has(item.refId),
      );
      const producesProductId =
        r.producesProductId && productIds.has(r.producesProductId) ? undefined : r.producesProductId;
      if (items.length === r.items.length && producesProductId === r.producesProductId) return r;
      return { ...r, items, producesProductId };
    });

  const products = state.products
    .filter((p) => !productIds.has(p.id))
    .map((p) => (p.recipeId && recipeIds.has(p.recipeId) ? { ...p, recipeId: undefined } : p));

  const dayPlans = state.dayPlans
    .map((plan) => ({ ...plan, entries: plan.entries.filter((e) => !productIds.has(e.productId)) }))
    .filter((plan) => plan.entries.length > 0);

  const specialEvents = state.specialEvents
    .map((ev) => ({ ...ev, extras: ev.extras.filter((ex) => !productIds.has(ex.productId)) }))
    .filter((ev) => ev.extras.length > 0);

  return {
    ...state,
    ingredients: state.ingredients.filter((i) => !ingredientIds.has(i.id)),
    products,
    recipes,
    tasks: state.tasks.filter((t) => t.recipeId === undefined || !recipeIds.has(t.recipeId)),
    taskOverrides: state.taskOverrides.filter((o) => !productIds.has(o.productId)),
    dayPlans,
    specialEvents,
    orderLines: state.orderLines.filter((l) => !ingredientIds.has(l.ingredientId)),
  };
}
