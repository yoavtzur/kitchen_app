import type { AppState, OrderLine } from '../types';
import { createSeedState, SCHEMA_VERSION } from '../data/seed';
import { todayStr } from '../lib/date';
import { ensureStations } from '../lib/migrateStations';
import { checkShape, checkVersion, summarize, type ImportResult } from './importValidation';

/** A v4 state: everything the current AppState has except the station list. */
type V4State = Omit<AppState, 'stations'>;

/** v5 replaces the fixed 5-category preset with a per-kitchen `stations` list a chef builds by
 * hand. `ensureStations` backs any category already in use into a real Station row so nothing
 * loses its station; see that function's own comment for why it's shared with the Supabase
 * bootstrap path rather than living only here. */
function migrateV4toV5(old: V4State): AppState {
  return { ...ensureStations(old), schemaVersion: 5 };
}

/** A v3 state: everything the current AppState has except dates on order lines. */
type V3State = Omit<V4State, 'orderLines'> & { orderLines: Omit<OrderLine, 'date'>[] };

/** v4 adds a date to every order line so the order sheet becomes a history instead of one
 * static snapshot. Every pre-existing line (the sheet in progress) is stamped with today, so it
 * survives the migration and becomes the first day of history rather than being silently lost. */
function migrateV3toV4(old: V3State): V4State {
  const today = todayStr();
  return {
    ...old,
    schemaVersion: 4,
    orderLines: old.orderLines.map((line) => ({ ...line, date: today })),
  };
}

const STORAGE_KEY = 'kitchen-app-state';

/** A v2 state: everything the current AppState has except the order sheet and station list. */
type V2State = Omit<V4State, 'orderLines'>;

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
function migrateV2toV3(old: V2State): V3State {
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
    orderLines: [],
  };
}

/**
 * Runs the migration chain for a version this build knows, oldest first.
 *
 * Shared by `loadState` and the backup importer so the two can never recognise a different set
 * of versions — which is exactly how the importer came to accept an unknown one: it carried its
 * own copy of this ladder, and its copy ended in `return parsed` instead of a rejection.
 *
 * Callers must have established that `version` is in 1..SCHEMA_VERSION first (see
 * `checkVersion`). An unrecognised version returns `null` rather than the input, so there is no
 * path through this function that hands back something it did not migrate.
 */
function migrateToCurrent(parsed: unknown, version: number): AppState | null {
  if (version === SCHEMA_VERSION) return parsed as AppState;
  if (version === 4) return migrateV4toV5(parsed as V4State);
  if (version === 3) return migrateV4toV5(migrateV3toV4(parsed as V3State));
  if (version === 2) return migrateV4toV5(migrateV3toV4(migrateV2toV3(parsed as V2State)));
  if (version === 1) {
    return migrateV4toV5(migrateV3toV4(migrateV2toV3(migrateV1toV2(parsed as Record<string, unknown>))));
  }
  return null;
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createSeedState();
    const parsed = JSON.parse(raw) as AppState;
    return migrateToCurrent(parsed, parsed.schemaVersion) ?? createSeedState();
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

/**
 * Parses, migrates and *validates* a backup file.
 *
 * Returns a result rather than throwing, because the caller has something to do with both
 * outcomes: a failure is a Hebrew sentence to render, and a success carries the summary the
 * confirm dialog shows before replacing a restaurant's entire state. See
 * `store/importValidation.ts` for why every step here is a rejection rather than a repair.
 */
export function parseImportedState(json: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'הקובץ אינו קובץ JSON תקין.' };
  }

  const version = checkVersion(parsed);
  if (!version.ok) return version;

  let migrated: AppState | null;
  try {
    migrated = migrateToCurrent(parsed, version.version);
  } catch {
    // A migration reading a field the file doesn't have. Reaching here means the file declared a
    // version whose shape it does not actually match, which is a corrupt backup, not a bug.
    return { ok: false, error: 'הגיבוי פגום ולא ניתן לשחזור.' };
  }
  if (!migrated) return { ok: false, error: 'הגיבוי פגום ולא ניתן לשחזור.' };

  const shape = checkShape(migrated);
  if (!shape.ok) return shape;

  // Settings is the one thing filled in rather than rejected — see the module comment on
  // importValidation.ts. Every field has a meaningful default and `migrateV1toV2` has always
  // done this, so a v1 backup missing a setting stays importable.
  const state: AppState = { ...shape.state, settings: { ...createSeedState().settings, ...shape.state.settings } };
  return { ok: true, state, summary: summarize(state, version.version) };
}
