import type { AppState } from '../types';
import { SCHEMA_VERSION } from '../data/seed';

/**
 * Structural validation for an imported backup file.
 *
 * Why this exists as its own module rather than a few `if`s inside `parseImportedState`: an
 * import is the single most destructive action in this app. In local mode it replaces the
 * browser's entire state; in remote mode `Settings` hands the result straight to the
 * `reset_snapshot` RPC, which replaces **the whole restaurant for every device at once**, with
 * no undo. Before this, `parseImportedState` recognised schema versions 1 to 4, and *anything
 * else fell through to `return parsed`* — so `{"schemaVersion":5}`, a two-field file, "imported
 * successfully" and wiped a kitchen. Every screen then crashed on `state.ingredients.map`,
 * because `ingredients` was `undefined`.
 *
 * Two rules follow from that, and they are the whole design:
 *
 * 1. **Nothing is trusted because it has a version number.** The version decides which migration
 *    chain runs; it is never on its own a reason to accept the file. What the chain *produces*
 *    is validated, so a bad file is caught once at the end no matter which path it took through
 *    the migrations.
 * 2. **Reject, never repair.** A partially-understood backup is silently deleted data — exactly
 *    the failure this module exists to prevent. The only thing rescued is `settings`, and only
 *    field by field against the seed defaults, because `migrateV1toV2` has always done that and
 *    a missing setting genuinely is recoverable (it has a default; an ingredient does not).
 */

/** Collections whose rows carry an `id` used as a React key and as a lookup key by the reducer.
 * A row without one doesn't "mostly work" — it breaks `pruneEntities`, every `find(...)` and
 * every list render. */
const ID_COLLECTIONS = [
  'ingredients',
  'products',
  'recipes',
  'tasks',
  'taskOverrides',
  'specialEvents',
  'cooks',
  'stations',
] as const;

/** The two keyed by something composite instead — see `orderLineKey` in lib/date.ts and
 * `DayPlan.date`. Validated on the fields that actually form their key. */
const KEYED_COLLECTIONS = {
  dayPlans: ['date'],
  orderLines: ['ingredientId', 'date'],
} as const;

const ALL_COLLECTIONS = [...ID_COLLECTIONS, ...(Object.keys(KEYED_COLLECTIONS) as (keyof typeof KEYED_COLLECTIONS)[])];

/** Hebrew names, so the error a cook reads says "מתכונים" and not "recipes". */
const COLLECTION_LABELS: Record<string, string> = {
  ingredients: 'מצרכים',
  products: 'מוצרים',
  recipes: 'מתכונים',
  tasks: 'משימות',
  taskOverrides: 'סימוני משימות',
  specialEvents: 'אירועים מיוחדים',
  dayPlans: 'תוכנית יומית',
  orderLines: 'שורות הזמנה',
  cooks: 'טבחים',
  stations: 'עמדות',
};

/** What the file contains, in the terms the confirm dialog puts to the user before it replaces
 * everything. Counts only — never names, since this is rendered next to "this cannot be undone"
 * and the point is the scale of the change, not its contents. */
export type ImportSummary = {
  /** The version the *file* declared, before migration. Worth showing: importing an old backup
   * is legitimate, but the user should know that is what they are doing. */
  fromVersion: number;
  ingredients: number;
  products: number;
  recipes: number;
  tasks: number;
  cooks: number;
};

export type ImportResult =
  | { ok: true; state: AppState; summary: ImportSummary }
  | { ok: false; error: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Checks the *declared* version before any migration runs.
 *
 * A version above this build's is refused rather than attempted: it is a backup written by a
 * newer app, so its shape is by definition one this code does not know, and "import it anyway"
 * means writing an unreadable snapshot over a working restaurant. Telling the user to update is
 * both true and actionable — the update is already offered by `UpdatePrompt`.
 */
export function checkVersion(value: unknown): { ok: true; version: number } | { ok: false; error: string } {
  if (!isObject(value)) return { ok: false, error: 'הקובץ אינו קובץ גיבוי של האפליקציה.' };
  const version = value.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: 'לקובץ אין מספר גרסה תקין — ייתכן שהוא אינו גיבוי של האפליקציה.' };
  }
  if (version > SCHEMA_VERSION) {
    return {
      ok: false,
      error: `הגיבוי נוצר בגרסה חדשה יותר של האפליקציה (${version}). יש לעדכן את האפליקציה לפני הייבוא.`,
    };
  }
  return { ok: true, version };
}

/**
 * Validates a fully-migrated state. This runs on the *output* of the migration chain, so it is
 * the one place that decides whether a file is safe to commit, regardless of which version it
 * arrived as.
 */
export function checkShape(value: unknown): { ok: true; state: AppState } | { ok: false; error: string } {
  if (!isObject(value)) return { ok: false, error: 'הקובץ אינו קובץ גיבוי של האפליקציה.' };

  for (const key of ALL_COLLECTIONS) {
    if (!Array.isArray(value[key])) {
      return { ok: false, error: `הגיבוי חסר או פגום: ${COLLECTION_LABELS[key] ?? key}.` };
    }
  }
  if (!isObject(value.settings)) {
    return { ok: false, error: 'הגיבוי חסר או פגום: הגדרות.' };
  }

  for (const key of ID_COLLECTIONS) {
    const rows = value[key] as unknown[];
    const bad = rows.findIndex((row) => !isObject(row) || !isNonEmptyString(row.id));
    if (bad !== -1) {
      return { ok: false, error: `הגיבוי פגום: ל${COLLECTION_LABELS[key] ?? key} בשורה ${bad + 1} חסר מזהה.` };
    }
  }

  for (const [key, fields] of Object.entries(KEYED_COLLECTIONS)) {
    const rows = value[key] as unknown[];
    const bad = rows.findIndex((row) => !isObject(row) || fields.some((f) => !isNonEmptyString(row[f])));
    if (bad !== -1) {
      return { ok: false, error: `הגיבוי פגום: ל${COLLECTION_LABELS[key] ?? key} בשורה ${bad + 1} חסרים שדות.` };
    }
  }

  // Optional collections are absent in an older backup, which is fine — but present and not a list
  // would crash the waste screen, so that is as bad as a missing required one.
  if (value.wasteLog !== undefined && !Array.isArray(value.wasteLog)) {
    return { ok: false, error: 'הגיבוי חסר או פגום: יומן זריקות.' };
  }
  if (value.suppliers !== undefined && !Array.isArray(value.suppliers)) {
    return { ok: false, error: 'הגיבוי חסר או פגום: ספקים.' };
  }

  // `entries` is the one nested array anything reads without checking — `Consumption` and
  // `calc.ts` both walk it directly off a DayPlan.
  const dayPlans = value.dayPlans as Record<string, unknown>[];
  if (dayPlans.some((plan) => !Array.isArray(plan.entries))) {
    return { ok: false, error: 'הגיבוי פגום: תוכנית יומית ללא פריטים.' };
  }
  const recipes = value.recipes as Record<string, unknown>[];
  if (recipes.some((recipe) => !Array.isArray(recipe.items))) {
    return { ok: false, error: 'הגיבוי פגום: מתכון ללא רשימת מרכיבים.' };
  }

  return { ok: true, state: value as unknown as AppState };
}

export function summarize(state: AppState, fromVersion: number): ImportSummary {
  return {
    fromVersion,
    ingredients: state.ingredients.length,
    products: state.products.length,
    recipes: state.recipes.length,
    tasks: state.tasks.length,
    cooks: state.cooks.length,
  };
}
