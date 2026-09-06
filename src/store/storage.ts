import type { AppState, OrderLine } from '../types';
import { createSeedState, SCHEMA_VERSION } from '../data/seed';

const STORAGE_KEY = 'kitchen-app-state';

/** A v2 state: everything the current AppState has except the order sheet. */
type V2State = Omit<AppState, 'orderLines'>;

/** v1 had no taskOverrides and Task.source could be 'auto'; v2 drops frozen auto-tasks
 * in favor of live computation, keeping only the manual tasks the user actually created. */
function migrateV1toV2(old: Record<string, unknown>): V2State {
  const oldTasks = Array.isArray(old.tasks) ? (old.tasks as Array<Record<string, unknown>>) : [];
  return {
    schemaVersion: 2,
    ingredients: (old.ingredients as AppState['ingredients']) ?? [],
    products: (old.products as AppState['products']) ?? [],
    recipes: (old.recipes as AppState['recipes']) ?? [],
    cooks: (old.cooks as AppState['cooks']) ?? [],
    settings: (old.settings as AppState['settings']) ?? createSeedState().settings,
    specialEvents: (old.specialEvents as AppState['specialEvents']) ?? [],
    dayPlans: (old.dayPlans as AppState['dayPlans']) ?? [],
    tasks: oldTasks.filter((t) => t.source === 'manual') as AppState['tasks'],
    taskOverrides: [],
  };
}

/**
 * v3 makes a prep item a single thing: the recipe⇄product link must agree on both sides
 * (`Product.recipeId` ⇔ `Recipe.producesProductId`) and a recipe must yield in its product's
 * stock unit. Older data was written by an editor that only ever set one side, so repair the
 * link here rather than dropping the user's recipes. Also prunes references to entities that
 * were deleted before deletes cascaded, and adds the persistent order sheet.
 */
function migrateV2toV3(old: V2State): AppState {
  const ingredients = old.ingredients ?? [];
  const products = [...(old.products ?? [])];
  const recipes = [...(old.recipes ?? [])];

  const ingredientIds = new Set(ingredients.map((i) => i.id));
  const productById = new Map(products.map((p, i) => [p.id, i] as const));
  const recipeById = new Map(recipes.map((r, i) => [r.id, i] as const));

  // Drop links that point at entities which no longer exist.
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    if (p.recipeId && !recipeById.has(p.recipeId)) products[i] = { ...p, recipeId: undefined };
  }
  for (let i = 0; i < recipes.length; i++) {
    const r = recipes[i];
    if (r.producesProductId && !productById.has(r.producesProductId)) {
      recipes[i] = { ...r, producesProductId: undefined };
    }
  }

  // The product side is authoritative: the first product claiming a recipe keeps it.
  const recipeOwner = new Map<string, string>();
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    if (!p.recipeId) continue;
    if (recipeOwner.has(p.recipeId)) {
      products[i] = { ...p, recipeId: undefined };
      continue;
    }
    recipeOwner.set(p.recipeId, p.id);
  }

  // A recipe that named a product nobody claimed gets to keep it (this is the case the old
  // editor produced: producesProductId set, Product.recipeId never written).
  for (let i = 0; i < recipes.length; i++) {
    const r = recipes[i];
    if (!r.producesProductId || recipeOwner.has(r.id)) continue;
    const pIdx = productById.get(r.producesProductId);
    if (pIdx === undefined) continue;
    if (products[pIdx].recipeId) {
      recipes[i] = { ...r, producesProductId: undefined };
      continue;
    }
    products[pIdx] = { ...products[pIdx], recipeId: r.id };
    recipeOwner.set(r.id, r.producesProductId);
  }

  // Write the agreed link back to both sides and align the recipe's yield unit.
  for (const [recipeId, productId] of recipeOwner) {
    const rIdx = recipeById.get(recipeId);
    const pIdx = productById.get(productId);
    if (rIdx === undefined || pIdx === undefined) continue;
    recipes[rIdx] = {
      ...recipes[rIdx],
      producesProductId: productId,
      yieldUnit: products[pIdx].unit,
    };
  }

  const productIds = new Set(products.map((p) => p.id));
  const recipeIds = new Set(recipes.map((r) => r.id));

  const cleanedRecipes = recipes.map((r) => ({
    ...r,
    items: r.items.filter((item) =>
      item.refType === 'ingredient' ? ingredientIds.has(item.refId) : productIds.has(item.refId),
    ),
  }));

  return {
    ...old,
    schemaVersion: 3,
    ingredients,
    products,
    recipes: cleanedRecipes,
    tasks: (old.tasks ?? []).filter((t) => t.recipeId === undefined || recipeIds.has(t.recipeId)),
    taskOverrides: (old.taskOverrides ?? []).filter((o) => productIds.has(o.productId)),
    dayPlans: (old.dayPlans ?? [])
      .map((plan) => ({ ...plan, entries: plan.entries.filter((e) => productIds.has(e.productId)) }))
      .filter((plan) => plan.entries.length > 0),
    specialEvents: (old.specialEvents ?? [])
      .map((ev) => ({ ...ev, extras: ev.extras.filter((ex) => productIds.has(ex.productId)) }))
      .filter((ev) => ev.extras.length > 0),
    orderLines: [] as OrderLine[],
  };
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createSeedState();
    const parsed = JSON.parse(raw) as AppState;
    if (parsed.schemaVersion === SCHEMA_VERSION) return parsed;
    if (parsed.schemaVersion === 2) return migrateV2toV3(parsed as unknown as V2State);
    if (parsed.schemaVersion === 1) {
      return migrateV2toV3(migrateV1toV2(parsed as unknown as Record<string, unknown>));
    }
    return createSeedState();
  } catch {
    return createSeedState();
  }
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage unavailable (private mode, quota) — silently skip persistence
  }
}

export function exportStateAsJson(state: AppState): string {
  return JSON.stringify(state, null, 2);
}

export function parseImportedState(json: string): AppState {
  const parsed = JSON.parse(json) as AppState;
  if (typeof parsed !== 'object' || parsed === null || !('schemaVersion' in parsed)) {
    throw new Error('קובץ לא תקין');
  }
  if (parsed.schemaVersion === 2) return migrateV2toV3(parsed as unknown as V2State);
  if (parsed.schemaVersion === 1) {
    return migrateV2toV3(migrateV1toV2(parsed as unknown as Record<string, unknown>));
  }
  return parsed;
}
