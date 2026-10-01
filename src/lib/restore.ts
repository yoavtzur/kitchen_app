import type {
  AppState,
  AutoTaskOverride,
  Cook,
  DayPlan,
  Ingredient,
  OrderLine,
  Product,
  Recipe,
  RecurringTask,
  SpecialEvent,
  Station,
  Task,
} from '../types';
import { orderLineKey } from './date';

/**
 * Undoing a deletion without asking "are you sure?" first.
 *
 * A delete here is rarely one row: removing a recipe takes its product, that product's tasks, its
 * day-plan entries and its order lines with it (`pruneEntities`), and rewrites every recipe that
 * used it. So "undo" cannot be one `ADD_*` — it has to put back *everything the deletion touched*.
 * `diffForRestore` computes exactly that, from the state before and after, and `applyRestore`
 * puts it back as an upsert.
 *
 * Both are pure and the restoring action carries plain data, so replaying it on another device is
 * deterministic and harmless the second time. The known cost is that it restores the **before**
 * version of each touched entity, so an edit to one of those same entities made on another device
 * in the few seconds before undo is overwritten. That window is the undo toast's lifetime.
 */
export type Restore = {
  ingredients?: Ingredient[];
  products?: Product[];
  recipes?: Recipe[];
  tasks?: Task[];
  taskOverrides?: AutoTaskOverride[];
  dayPlans?: DayPlan[];
  specialEvents?: SpecialEvent[];
  orderLines?: OrderLine[];
  cooks?: Cook[];
  stations?: Station[];
  recurringTasks?: RecurringTask[];
};

type KeyedCollections = {
  [K in keyof Restore]-?: { items: (state: AppState) => NonNullable<Restore[K]>; key: (item: NonNullable<Restore[K]>[number]) => string };
};

const COLLECTIONS: KeyedCollections = {
  ingredients: { items: (s) => s.ingredients, key: (i) => i.id },
  products: { items: (s) => s.products, key: (p) => p.id },
  recipes: { items: (s) => s.recipes, key: (r) => r.id },
  tasks: { items: (s) => s.tasks, key: (t) => t.id },
  taskOverrides: { items: (s) => s.taskOverrides, key: (o) => o.id },
  dayPlans: { items: (s) => s.dayPlans, key: (p) => p.date },
  specialEvents: { items: (s) => s.specialEvents, key: (e) => e.id },
  orderLines: { items: (s) => s.orderLines, key: (l) => orderLineKey(l.ingredientId, l.date) },
  cooks: { items: (s) => s.cooks, key: (c) => c.id },
  stations: { items: (s) => s.stations ?? [], key: (st) => st.id },
  recurringTasks: { items: (s) => s.recurringTasks ?? [], key: (r) => r.id },
};

const NAMES = Object.keys(COLLECTIONS) as (keyof Restore)[];

/** The before-version of every entity that `after` no longer has, or has in a different shape. */
export function diffForRestore(before: AppState, after: AppState): Restore {
  const out: Record<string, unknown[]> = {};
  for (const name of NAMES) {
    const { items, key } = COLLECTIONS[name] as { items: (s: AppState) => unknown[]; key: (i: unknown) => string };
    const afterByKey = new Map(items(after).map((item) => [key(item), item]));
    const touched = items(before).filter((item) => {
      const now = afterByKey.get(key(item));
      return now === undefined || (now !== item && JSON.stringify(now) !== JSON.stringify(item));
    });
    if (touched.length > 0) out[name] = touched;
  }
  return out as Restore;
}

/** Upserts each restored entity: replaced in place if it still exists, appended if it does not. */
export function applyRestore(state: AppState, restore: Restore): AppState {
  let next = state;
  for (const name of NAMES) {
    const incoming = restore[name] as unknown[] | undefined;
    if (!incoming || incoming.length === 0) continue;
    const { items, key } = COLLECTIONS[name] as { items: (s: AppState) => unknown[]; key: (i: unknown) => string };
    const current = items(next);
    const incomingByKey = new Map(incoming.map((item) => [key(item), item]));
    const seen = new Set<string>();
    const merged = current.map((item) => {
      const k = key(item);
      const replacement = incomingByKey.get(k);
      if (replacement === undefined) return item;
      seen.add(k);
      return replacement;
    });
    for (const [k, item] of incomingByKey) if (!seen.has(k)) merged.push(item);
    next = { ...next, [name]: merged };
  }
  return next;
}
