import type {
  AppState,
  AutoTaskOverride,
  Cook,
  DayPlanEntry,
  ExpiryChange,
  Ingredient,
  OrderLine,
  Priority,
  Product,
  Recipe,
  RecurringTask,
  Settings,
  SpecialEvent,
  Station,
  Supplier,
  Task,
  TaskCompletion,
  Unit,
  WasteEntry,
  WasteItemType,
  Weekday,
  WeekdayUsage,
} from '../types';
import { todayStr } from '../lib/date';
import { autoTaskId } from '../lib/tasks';
import { pruneEntities } from '../lib/integrity';
import { applyRestore, type Restore } from '../lib/restore';
import { carryOver } from '../lib/carryOver';
import { batchExpiry } from '../lib/expiry';
import { materializeRecurring } from '../lib/recurring';
import { ackAllFor, ackRecipeNotice, noteRecipeChange } from '../lib/notices';
import { UNASSIGNED_CATEGORY } from '../lib/recipeCategories';
import { convert } from '../lib/units';

export type Action =
  | { type: 'SET_INGREDIENT_QTY'; id: string; qty: number }
  /** Absolute, not a toggle: two cooks tapping "חסר" on the same ingredient agree. */
  | { type: 'SET_INGREDIENT_SHORT'; id: string; short: boolean }
  | { type: 'SET_INGREDIENT_USAGE'; id: string; dailyUsage?: number; weeklyUsage?: number }
  | { type: 'SET_INGREDIENT_PAR'; id: string; parLevel: number }
  | { type: 'SET_INGREDIENT_WEEKDAY_USAGE'; id: string; weekday: Weekday; dailyUsage?: number }
  | { type: 'SET_INGREDIENT_UNIT'; id: string; unit: Unit }
  | { type: 'ADD_INGREDIENT'; ingredient: Ingredient }
  | { type: 'UPDATE_INGREDIENT'; ingredient: Ingredient }
  | { type: 'DELETE_INGREDIENT'; id: string }
  // `today` is stamped by the dispatcher at the moment of the call (see Home.tsx/StockCount.tsx)
  // rather than read from the wall clock inside the reducer, so the same action replayed later
  // — on another device, in another timezone, or after midnight — always produces the same state.
  | { type: 'SET_PRODUCT_QTY'; id: string; qty: number; today?: string }
  | {
      type: 'BULK_UPDATE_QUANTITIES';
      ingredients: { id: string; qty: number }[];
      products: { id: string; qty: number }[];
      today?: string;
    }
  | { type: 'SET_PRODUCT_TARGETS'; id: string; weeklyTarget?: number; dailyUsage?: number }
  /** Absolute; `null` clears the minimum (JSON drops `undefined`, so it cannot mean "clear"). */
  | { type: 'SET_PRODUCT_PAR'; id: string; parLevel: number | null }
  | { type: 'SET_PRODUCT_WEEKDAY_USAGE'; id: string; weekday: Weekday; dailyUsage?: number }
  | { type: 'ADD_PRODUCT'; product: Product }
  | { type: 'UPDATE_PRODUCT'; product: Product }
  | { type: 'DELETE_PRODUCT'; id: string }
  /** `byCookId` is who made the edit: they wrote it, so they are not asked to acknowledge it. */
  | { type: 'SAVE_PREP_ITEM'; recipe: Recipe; product: Product; byCookId?: string }
  | { type: 'ADD_RECIPE'; recipe: Recipe }
  | { type: 'UPDATE_RECIPE'; recipe: Recipe; byCookId?: string }
  /** A cook has read revision `rev` of a recipe's change notice (lib/notices.ts). */
  | { type: 'ACK_RECIPE_NOTICE'; recipeId: string; rev: number; cookId: string }
  | { type: 'DELETE_RECIPE'; id: string }
  | { type: 'ADD_TASK'; task: Task }
  | { type: 'UPDATE_TASK'; task: Task }
  | { type: 'DELETE_TASK'; id: string }
  | { type: 'SET_TASK_PRIORITY'; id: string; priority: Priority }
  | { type: 'SET_TASK_ASSIGNEE'; id: string; assigneeId?: string | null }
  | {
      type: 'CONFIRM_TASK_COMPLETION';
      taskId: string;
      ingredientDeltas: { id: string; delta: number }[];
      producedProductId?: string;
      producedQty?: number;
      /** Last good day of the batch this completion makes (the caller's today + the recipe's shelf life). */
      producedExpiresOn?: string;
    }
  | { type: 'UNDO_TASK_COMPLETION'; id: string }
  | {
      type: 'CONFIRM_AUTO_TASK_COMPLETION';
      id: string;
      productId: string;
      date: string;
      ingredientDeltas: { id: string; delta: number }[];
      producedProductId?: string;
      producedQty?: number;
      /** See CONFIRM_TASK_COMPLETION. */
      producedExpiresOn?: string;
    }
  | { type: 'UNDO_AUTO_TASK_COMPLETION'; id: string }
  | { type: 'DISMISS_AUTO_TASK'; id: string; productId: string; date: string }
  | { type: 'SET_AUTO_TASK_PRIORITY'; id: string; productId: string; date: string; priority: Priority }
  // `null` clears the field; `undefined`/omitted leaves it untouched. Plain JS `undefined`
  // can't carry that meaning once an action has to survive JSON (localStorage, the network):
  // JSON.stringify drops undefined-valued keys, silently turning "clear" into a no-op.
  | { type: 'SET_AUTO_TASK_ASSIGNEE'; id: string; productId: string; date: string; assigneeId?: string | null }
  | {
      type: 'SET_DAY_PLAN_ENTRY';
      date: string;
      entry: { productId: string; requiredQty?: number; prepOverride?: number | null };
    }
  | { type: 'ADD_SPECIAL_EVENT'; event: SpecialEvent }
  | { type: 'UPDATE_SPECIAL_EVENT'; event: SpecialEvent }
  | { type: 'DELETE_SPECIAL_EVENT'; id: string }
  /** Puts back what a deletion took out (see lib/restore.ts) — the "בטל" after deleting a recipe,
   * ingredient, station or cook. An upsert, so replaying it is harmless. */
  | { type: 'RESTORE_ENTITIES'; restore: Restore }
  /** Start of a new day: open manual tasks move to `today` and auto-task assignee/priority carry
   * over (lib/carryOver.ts). `today` comes from the dispatcher, never the clock. Idempotent. */
  | { type: 'CARRY_OVER_TASKS'; today: string }
  /** A standing task and, if it is due today, today's first instance (lib/recurring.ts). */
  | { type: 'ADD_RECURRING_TASK'; rule: RecurringTask; today: string }
  | { type: 'UPDATE_RECURRING_TASK'; rule: RecurringTask }
  | { type: 'DELETE_RECURRING_TASK'; id: string }
  /** Makes today's task from every standing task that is due and has not been made yet. */
  | { type: 'MATERIALIZE_RECURRING'; today: string }
  | { type: 'ADD_COOK'; cook: Cook }
  | { type: 'RENAME_COOK'; id: string; name: string }
  | { type: 'DELETE_COOK'; id: string }
  | { type: 'REMOVE_COOK'; id: string }
  | { type: 'ADD_STATION'; station: Station }
  | { type: 'RENAME_STATION'; id: string; name: string }
  // `moveToId` is where this station's recipes and free-text tasks go: another station's id or
  // 'general'. It is resolved against the state at apply time, so the op stays deterministic and
  // an unknown target degrades to 'general' instead of orphaning anything.
  | { type: 'DELETE_STATION'; id: string; moveToId: string }
  /** Upsert by id. A changed name re-points every ingredient that carried the old one. */
  | { type: 'SAVE_SUPPLIER'; supplier: Supplier }
  /** Removes the card only: ingredients keep the supplier's name. */
  | { type: 'DELETE_SUPPLIER'; id: string }
  | { type: 'SET_ORDER_LINE_QTY'; ingredientId: string; date: string; qtyOverride?: number | null }
  | { type: 'SET_ORDER_LINE_ORDERED'; ingredientId: string; date: string; ordered: boolean }
  /** Sets how much of one order line has arrived. Absolute — stock moves by the *difference* from
   * what was recorded before, so replaying it, or two cooks tapping the same row, adds nothing
   * twice; and undo is just this action with the previous number. */
  | { type: 'SET_LINE_RECEIVED'; ingredientId: string; date: string; receivedQty: number }
  | { type: 'RECEIVE_ORDER'; date: string; receipts: { ingredientId: string; qty: number }[] }
  | { type: 'CLEAR_ORDER_SHEET'; date: string }
  // Absolute set (idempotent under replay), mirroring SET_ORDER_LINE_ORDERED's own reasoning:
  // submits the whole current-day sheet as one op instead of one op per ingredient.
  | { type: 'SUBMIT_ORDER'; date: string; lines: { ingredientId: string; qty: number }[] }
  /** Sets (or, with null, clears) an item's last-good day. Absolute, so extending twice agrees. */
  | { type: 'SET_EXPIRY'; itemType: WasteItemType; id: string; expiresOn: string | null }
  /** Something was thrown away: appends the log row and takes `entry.qty` out of stock. The row's
   * id is made by the dispatcher, and a row already in the log is ignored, so a replayed or
   * retried op never throws the same food away twice. */
  | { type: 'LOG_WASTE'; entry: WasteEntry }
  /** "בטל" for LOG_WASTE: removes that row and puts its quantity (and expiry date) back. */
  | { type: 'UNDO_WASTE'; id: string }
  | { type: 'UPDATE_SETTINGS'; settings: Partial<Settings> }
  | { type: 'IMPORT_STATE'; state: AppState };

/**
 * Enforces the one invariant that makes a prep item feel like a single thing:
 * `product.recipeId === recipe.id` ⇔ `recipe.producesProductId === product.id`, with the
 * recipe yielding in the product's stock unit. Any other product/recipe that previously
 * claimed one of the two is unlinked, so a stale half-link can never survive a save.
 */
function linkRecipeProduct(
  state: AppState,
  recipeId: string,
  productId: string | undefined,
): AppState {
  const product = productId ? state.products.find((p) => p.id === productId) : undefined;
  return {
    ...state,
    products: state.products.map((p) => {
      if (p.id === productId) return p.recipeId === recipeId ? p : { ...p, recipeId };
      return p.recipeId === recipeId ? { ...p, recipeId: undefined } : p;
    }),
    recipes: state.recipes.map((r) => {
      if (r.id === recipeId) {
        return { ...r, producesProductId: productId, yieldUnit: product?.unit ?? r.yieldUnit };
      }
      return productId && r.producesProductId === productId
        ? { ...r, producesProductId: undefined }
        : r;
    }),
  };
}

function upsertOrderLine(
  state: AppState,
  ingredientId: string,
  date: string,
  patch: Partial<OrderLine>,
): AppState {
  const existing = state.orderLines.find((l) => l.ingredientId === ingredientId && l.date === date);
  const next: OrderLine = existing
    ? { ...existing, ...patch }
    : { ingredientId, date, ordered: false, ...patch };
  return {
    ...state,
    orderLines: existing
      ? state.orderLines.map((l) => (l.ingredientId === ingredientId && l.date === date ? next : l))
      : [...state.orderLines, next],
  };
}

function upsertTaskOverride(
  state: AppState,
  id: string,
  base: { productId: string; date: string },
  patch: Partial<AutoTaskOverride>,
): AppState {
  const existing = state.taskOverrides.find((o) => o.id === id);
  const next: AutoTaskOverride = existing
    ? { ...existing, ...patch }
    : { id, productId: base.productId, date: base.date, ...patch };
  return {
    ...state,
    taskOverrides: existing
      ? state.taskOverrides.map((o) => (o.id === id ? next : o))
      : [...state.taskOverrides, next],
  };
}

function applyIngredientDeltas(
  ingredients: AppState['ingredients'],
  deltas: { id: string; delta: number }[],
  sign: 1 | -1,
): AppState['ingredients'] {
  let result = ingredients;
  for (const d of deltas) {
    result = result.map((i) =>
      i.id === d.id ? { ...i, currentQty: Math.max(0, i.currentQty + sign * d.delta) } : i,
    );
  }
  return result;
}

function applyProducedQty(
  products: AppState['products'],
  productId: string | undefined,
  qty: number | undefined,
  sign: 1 | -1,
): AppState['products'] {
  if (!productId || qty === undefined) return products;
  return products.map((p) =>
    p.id === productId ? { ...p, currentQty: Math.max(0, p.currentQty + sign * qty) } : p,
  );
}

/** Sets or drops the two expiry keys without leaving `undefined` behind (JSON would drop it, and a replay must match). */
function withExpiryFields(
  product: Product,
  fields: { expiresOn?: string; lastBatchExpiresOn?: string },
): Product {
  const { expiresOn: _e, lastBatchExpiresOn: _l, ...rest } = product;
  return {
    ...rest,
    ...(fields.expiresOn ? { expiresOn: fields.expiresOn } : {}),
    ...(fields.lastBatchExpiresOn ? { lastBatchExpiresOn: fields.lastBatchExpiresOn } : {}),
  };
}

/**
 * A prep completion's effect on the produced product's dates. Computed from the stock **before**
 * the produced quantity is added — "was there already something on the shelf?" is the question.
 * Returns the change to record on the completion, or `undefined` when there is nothing to set.
 */
function planBatchExpiry(
  products: AppState['products'],
  productId: string | undefined,
  qty: number | undefined,
  batchExpiresOn: string | undefined,
): ExpiryChange | undefined {
  if (!productId || !batchExpiresOn || qty === undefined || qty <= 0) return undefined;
  const product = products.find((p) => p.id === productId);
  return product ? batchExpiry(product, batchExpiresOn) : undefined;
}

function applyExpiryChange(products: AppState['products'], productId: string | undefined, change: ExpiryChange | undefined): AppState['products'] {
  if (!productId || !change) return products;
  return products.map((p) => (p.id === productId ? withExpiryFields(p, change.after) : p));
}

/** Undo puts the old dates back only if nobody has changed them since — an extension made after
 * the completion is newer information than the completion's own. */
function revertExpiryChange(products: AppState['products'], productId: string | undefined, change: ExpiryChange | undefined): AppState['products'] {
  if (!productId || !change) return products;
  return products.map((p) =>
    p.id === productId && p.expiresOn === change.after.expiresOn && p.lastBatchExpiresOn === change.after.lastBatchExpiresOn
      ? withExpiryFields(p, change.before)
      : p,
  );
}

/** Editing a product elsewhere (the recipe editor) must not erase its dates: the form has no field for them. */
function keepExpiry(existing: Product | undefined, incoming: Product): Product {
  if (!existing) return incoming;
  return {
    ...incoming,
    ...(incoming.expiresOn === undefined && existing.expiresOn ? { expiresOn: existing.expiresOn } : {}),
    ...(incoming.lastBatchExpiresOn === undefined && existing.lastBatchExpiresOn
      ? { lastBatchExpiresOn: existing.lastBatchExpiresOn }
      : {}),
  };
}

/**
 * Builds the actual fields to merge into a DayPlanEntry from a patch that may have travelled
 * through JSON: a field is left untouched when omitted (or plain `undefined` — the two are
 * indistinguishable once round-tripped), set when given a value, and cleared only via an
 * explicit `null`, which survives JSON.stringify unlike `undefined`.
 */
function upsertDayPlanEntry(
  state: AppState,
  date: string,
  patch: { productId: string; requiredQty?: number; prepOverride?: number | null },
): AppState {
  const fields: Partial<DayPlanEntry> = {};
  if (patch.requiredQty !== undefined) fields.requiredQty = patch.requiredQty;
  if (patch.prepOverride !== undefined) {
    fields.prepOverride = patch.prepOverride === null ? undefined : patch.prepOverride;
  }
  const baseEntry: DayPlanEntry = { productId: patch.productId, ...fields };

  const existingPlan = state.dayPlans.find((p) => p.date === date);
  if (!existingPlan) {
    return { ...state, dayPlans: [...state.dayPlans, { date, entries: [baseEntry] }] };
  }
  const existingEntryIdx = existingPlan.entries.findIndex((e) => e.productId === patch.productId);
  const newEntries =
    existingEntryIdx === -1
      ? [...existingPlan.entries, baseEntry]
      : existingPlan.entries.map((e, i) => (i === existingEntryIdx ? { ...e, ...fields } : e));
  return {
    ...state,
    dayPlans: state.dayPlans.map((p) => (p.date === date ? { ...p, entries: newEntries } : p)),
  };
}

/**
 * Applies a real stock-count update to one product, reusing exactly the side effects
 * SET_PRODUCT_QTY always had: a fresh count for today supersedes a stale manual "prep for
 * today" override, and resurfaces a task dismissed earlier today if there's still a need.
 * BULK_UPDATE_QUANTITIES (the stock-count screen) calls this once per product so a bulk
 * count behaves exactly like editing each product by hand.
 *
 * `today` is a parameter rather than read from the wall clock here so the reducer stays a pure
 * function of its arguments — replaying the same action later (a different device, a different
 * timezone, after midnight) always yields the same result. Callers that omit it get today by
 * the system clock, matching the previous behavior.
 */
function applyProductQtyUpdate(
  state: AppState,
  id: string,
  qty: number,
  today: string = todayStr(),
): AppState {
  let next: AppState = {
    ...state,
    products: state.products.map((p) => (p.id === id ? { ...p, currentQty: qty } : p)),
  };
  const todaysPlan = next.dayPlans.find((p) => p.date === today);
  const hadOverride = todaysPlan?.entries.some(
    (e) => e.productId === id && e.prepOverride !== undefined,
  );
  if (hadOverride) {
    next = {
      ...next,
      dayPlans: next.dayPlans.map((p) =>
        p.date === today
          ? {
              ...p,
              entries: p.entries.map((e) =>
                e.productId === id ? { ...e, prepOverride: undefined } : e,
              ),
            }
          : p,
      ),
    };
  }
  const todaysOverrideId = autoTaskId(id, today);
  const dismissedOverride = next.taskOverrides.find(
    (o) => o.id === todaysOverrideId && o.dismissed,
  );
  if (dismissedOverride) {
    next = upsertTaskOverride(
      next,
      todaysOverrideId,
      { productId: id, date: today },
      { dismissed: false },
    );
  }
  return next;
}

/** Sets or clears one weekday's dailyUsage override, dropping the map entirely once empty
 * so a fully-cleared entity looks the same as one that never had overrides. */
function withWeekdayOverride<T extends { dailyUsageByWeekday?: WeekdayUsage }>(
  entity: T,
  weekday: Weekday,
  dailyUsage: number | undefined,
): T {
  const next: WeekdayUsage = { ...(entity.dailyUsageByWeekday ?? {}) };
  if (dailyUsage === undefined) delete next[weekday];
  else next[weekday] = dailyUsage;
  return { ...entity, dailyUsageByWeekday: Object.keys(next).length > 0 ? next : undefined };
}

/** Sets an ingredient's stock. Raising it clears a "חסר" flag: the shortage was about what was on
 * the shelf, and a count or a delivery that adds stock has answered it. Lowering it (a waste
 * report, a count that found less) leaves the flag as it was. */
function withQty(ingredient: Ingredient, qty: number): Ingredient {
  if (!ingredient.shortFlag || qty <= ingredient.currentQty) return { ...ingredient, currentQty: qty };
  const { shortFlag: _cleared, ...rest } = ingredient;
  return { ...rest, currentQty: qty };
}

/** Drops the key without leaving `undefined` behind (JSON would drop it too, and a replay must match). */
function withoutExpiry<T extends { expiresOn?: string; lastBatchExpiresOn?: string }>(item: T): T {
  const { expiresOn: _cleared, lastBatchExpiresOn: _lastCleared, ...rest } = item;
  return rest as T;
}

function withExpiry<T extends { expiresOn?: string }>(item: T, expiresOn: string | null): T {
  return expiresOn === null ? withoutExpiry(item) : { ...item, expiresOn };
}

/** Moves one item's stock by `delta` (never below zero). Products go through
 * applyProductQtyUpdate so a stale "prep needed today" is recomputed like any other edit. */
function adjustStock(state: AppState, itemType: WasteItemType, id: string, delta: number, today: string): AppState {
  const round = (n: number) => Math.round(n * 1000) / 1000;
  if (itemType === 'ingredient') {
    return {
      ...state,
      ingredients: state.ingredients.map((i) =>
        i.id === id ? { ...i, currentQty: Math.max(0, round(i.currentQty + delta)) } : i,
      ),
    };
  }
  const product = state.products.find((p) => p.id === id);
  return product ? applyProductQtyUpdate(state, id, Math.max(0, round(product.currentQty + delta)), today) : state;
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_INGREDIENT_QTY':
      return {
        ...state,
        ingredients: state.ingredients.map((i) => (i.id === action.id ? withQty(i, action.qty) : i)),
      };
    case 'SET_INGREDIENT_SHORT':
      return {
        ...state,
        ingredients: state.ingredients.map((i) => {
          if (i.id !== action.id || Boolean(i.shortFlag) === action.short) return i;
          if (action.short) return { ...i, shortFlag: true };
          const { shortFlag: _cleared, ...rest } = i;
          return rest;
        }),
      };
    case 'SET_INGREDIENT_USAGE':
      return {
        ...state,
        ingredients: state.ingredients.map((i) =>
          i.id === action.id
            ? {
                ...i,
                dailyUsage: action.dailyUsage ?? i.dailyUsage,
                weeklyUsage: action.weeklyUsage ?? i.weeklyUsage,
              }
            : i,
        ),
      };
    case 'SET_INGREDIENT_PAR':
      return {
        ...state,
        ingredients: state.ingredients.map((i) =>
          i.id === action.id ? { ...i, parLevel: action.parLevel } : i,
        ),
      };
    case 'SET_INGREDIENT_WEEKDAY_USAGE':
      return {
        ...state,
        ingredients: state.ingredients.map((i) =>
          i.id === action.id ? withWeekdayOverride(i, action.weekday, action.dailyUsage) : i,
        ),
      };
    case 'SET_INGREDIENT_UNIT': {
      const target = state.ingredients.find((i) => i.id === action.id);
      if (!target || target.unit === action.unit) return state;
      const fromUnit = target.unit;
      // convert() returns null across unit families (e.g. weight <-> count) — there's no sensible
      // factor to apply, so the raw numbers are left as-is under the new unit. The UI warns before
      // dispatching a cross-family change for exactly this reason; the reducer just stays total
      // and deterministic either way, since it can't know whether the caller already confirmed.
      const convertQty = (qty: number) => convert(qty, fromUnit, action.unit) ?? qty;
      return {
        ...state,
        ingredients: state.ingredients.map((i) =>
          i.id === action.id
            ? {
                ...i,
                unit: action.unit,
                currentQty: convertQty(i.currentQty),
                dailyUsage: convertQty(i.dailyUsage),
                weeklyUsage: convertQty(i.weeklyUsage),
                parLevel: i.parLevel === undefined ? undefined : convertQty(i.parLevel),
                dailyUsageByWeekday: i.dailyUsageByWeekday
                  ? (Object.fromEntries(
                      Object.entries(i.dailyUsageByWeekday).map(([weekday, usage]) => [
                        weekday,
                        usage === undefined ? usage : convertQty(usage),
                      ]),
                    ) as WeekdayUsage)
                  : i.dailyUsageByWeekday,
              }
            : i,
        ),
        // A manual order-sheet override is typed in the ingredient's own unit too (see Orders.tsx)
        // — convert it along with everything else so the order sheet doesn't silently jump scale.
        orderLines: state.orderLines.map((line) =>
          line.ingredientId === action.id && line.qtyOverride !== undefined
            ? { ...line, qtyOverride: convertQty(line.qtyOverride) }
            : line,
        ),
      };
    }
    case 'ADD_INGREDIENT':
      return { ...state, ingredients: [...state.ingredients, action.ingredient] };
    case 'UPDATE_INGREDIENT':
      return {
        ...state,
        ingredients: state.ingredients.map((i) =>
          i.id === action.ingredient.id ? action.ingredient : i,
        ),
      };
    case 'DELETE_INGREDIENT':
      return pruneEntities(state, { ingredientIds: [action.id] });

    case 'SET_PRODUCT_QTY':
      return applyProductQtyUpdate(state, action.id, action.qty, action.today);
    case 'BULK_UPDATE_QUANTITIES': {
      // Ingredients have no per-day overrides to reconcile, so a plain replace is enough;
      // products route through applyProductQtyUpdate so a bulk count behaves exactly like
      // editing each one by hand (today's stale prep override still gets cleared, etc.).
      let next: AppState = {
        ...state,
        ingredients: state.ingredients.map((i) => {
          const update = action.ingredients.find((u) => u.id === i.id);
          return update ? withQty(i, update.qty) : i;
        }),
      };
      for (const update of action.products) {
        next = applyProductQtyUpdate(next, update.id, update.qty, action.today);
      }
      return next;
    }
    case 'SET_PRODUCT_PAR':
      return {
        ...state,
        products: state.products.map((p) => {
          if (p.id !== action.id) return p;
          const next = { ...p };
          if (action.parLevel === null || !(action.parLevel > 0)) delete next.parLevel;
          else next.parLevel = action.parLevel;
          return next;
        }),
      };
    case 'SET_PRODUCT_TARGETS':
      return {
        ...state,
        products: state.products.map((p) =>
          p.id === action.id
            ? {
                ...p,
                weeklyTarget: action.weeklyTarget ?? p.weeklyTarget,
                dailyUsage: action.dailyUsage ?? p.dailyUsage,
              }
            : p,
        ),
      };
    case 'SET_PRODUCT_WEEKDAY_USAGE':
      return {
        ...state,
        products: state.products.map((p) =>
          p.id === action.id ? withWeekdayOverride(p, action.weekday, action.dailyUsage) : p,
        ),
      };
    case 'ADD_PRODUCT': {
      const withProduct: AppState = { ...state, products: [...state.products, action.product] };
      if (!action.product.recipeId) return withProduct;
      return linkRecipeProduct(withProduct, action.product.recipeId, action.product.id);
    }
    case 'UPDATE_PRODUCT': {
      const withProduct: AppState = {
        ...state,
        products: state.products.map((p) => (p.id === action.product.id ? keepExpiry(p, action.product) : p)),
      };
      if (action.product.recipeId) {
        return linkRecipeProduct(withProduct, action.product.recipeId, action.product.id);
      }
      // Product no longer has a recipe: drop the claim from the recipe side too.
      return {
        ...withProduct,
        recipes: withProduct.recipes.map((r) =>
          r.producesProductId === action.product.id ? { ...r, producesProductId: undefined } : r,
        ),
      };
    }
    case 'DELETE_PRODUCT':
      return pruneEntities(state, { productIds: [action.id] });

    // Saves both halves of a prep item at once, so a newly created recipe is immediately
    // linked to its product and shows up on Home, Tasks, Consumption and Orders.
    case 'SAVE_PREP_ITEM': {
      const hasProduct = state.products.some((p) => p.id === action.product.id);
      const withProduct: AppState = {
        ...state,
        products: hasProduct
          ? state.products.map((p) => (p.id === action.product.id ? keepExpiry(p, action.product) : p))
          : [...state.products, action.product],
      };
      const hasRecipe = withProduct.recipes.some((r) => r.id === action.recipe.id);
      const withRecipe: AppState = {
        ...withProduct,
        recipes: hasRecipe
          ? withProduct.recipes.map((r) => (r.id === action.recipe.id ? action.recipe : r))
          : [...withProduct.recipes, action.recipe],
      };
      const linked = linkRecipeProduct(withRecipe, action.recipe.id, action.product.id);
      return noteRecipeChange(linked, hasRecipe ? state.recipes.find((r) => r.id === action.recipe.id) : undefined, action.recipe, action.byCookId);
    }
    case 'ADD_RECIPE': {
      const withRecipe: AppState = { ...state, recipes: [...state.recipes, action.recipe] };
      return linkRecipeProduct(withRecipe, action.recipe.id, action.recipe.producesProductId);
    }
    case 'UPDATE_RECIPE': {
      const withRecipe: AppState = {
        ...state,
        recipes: state.recipes.map((r) => (r.id === action.recipe.id ? action.recipe : r)),
      };
      const linked = linkRecipeProduct(withRecipe, action.recipe.id, action.recipe.producesProductId);
      return noteRecipeChange(linked, state.recipes.find((r) => r.id === action.recipe.id), action.recipe, action.byCookId);
    }
    case 'ACK_RECIPE_NOTICE':
      return ackRecipeNotice(state, action.recipeId, action.rev, action.cookId);
    case 'DELETE_RECIPE':
      return pruneEntities(state, { recipeIds: [action.id] });

    case 'ADD_TASK':
      return { ...state, tasks: [...state.tasks, action.task] };
    case 'UPDATE_TASK':
      return { ...state, tasks: state.tasks.map((t) => (t.id === action.task.id ? action.task : t)) };
    case 'DELETE_TASK':
      return { ...state, tasks: state.tasks.filter((t) => t.id !== action.id) };
    case 'SET_TASK_PRIORITY':
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.id ? { ...t, priority: action.priority, priorityManual: true } : t,
        ),
      };
    case 'SET_TASK_ASSIGNEE':
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.id
            ? { ...t, assigneeId: action.assigneeId === null ? undefined : action.assigneeId }
            : t,
        ),
      };
    case 'CONFIRM_TASK_COMPLETION': {
      // Idempotent: a task already marked done keeps its original appliedCompletion rather than
      // deducting the same ingredients twice (two cooks confirming the same task at once, or a
      // retried/rebased op arriving after it was already applied).
      const existingTask = state.tasks.find((t) => t.id === action.taskId);
      if (existingTask?.done) return state;
      const expiryChange = planBatchExpiry(state.products, action.producedProductId, action.producedQty, action.producedExpiresOn);
      const completion: TaskCompletion = {
        ingredientDeltas: action.ingredientDeltas,
        producedProductId: action.producedProductId,
        producedQty: action.producedQty,
        ...(expiryChange ? { expiryChange } : {}),
      };
      return {
        ...state,
        ingredients: applyIngredientDeltas(state.ingredients, action.ingredientDeltas, -1),
        products: applyExpiryChange(
          applyProducedQty(state.products, action.producedProductId, action.producedQty, 1),
          action.producedProductId,
          expiryChange,
        ),
        tasks: state.tasks.map((t) =>
          t.id === action.taskId ? { ...t, done: true, appliedCompletion: completion } : t,
        ),
      };
    }
    case 'UNDO_TASK_COMPLETION': {
      const task = state.tasks.find((t) => t.id === action.id);
      const completion = task?.appliedCompletion;
      if (!completion) return state;
      return {
        ...state,
        ingredients: applyIngredientDeltas(state.ingredients, completion.ingredientDeltas, 1),
        products: revertExpiryChange(
          applyProducedQty(state.products, completion.producedProductId, completion.producedQty, -1),
          completion.producedProductId,
          completion.expiryChange,
        ),
        tasks: state.tasks.map((t) =>
          t.id === action.id ? { ...t, done: false, appliedCompletion: undefined } : t,
        ),
      };
    }

    case 'CONFIRM_AUTO_TASK_COMPLETION': {
      // Same idempotency guard as CONFIRM_TASK_COMPLETION, keyed on the override row.
      const existingOverride = state.taskOverrides.find((o) => o.id === action.id);
      if (existingOverride?.done) return state;
      const expiryChange = planBatchExpiry(state.products, action.producedProductId, action.producedQty, action.producedExpiresOn);
      const completion: TaskCompletion = {
        ingredientDeltas: action.ingredientDeltas,
        producedProductId: action.producedProductId,
        producedQty: action.producedQty,
        ...(expiryChange ? { expiryChange } : {}),
      };
      const withInventory: AppState = {
        ...state,
        ingredients: applyIngredientDeltas(state.ingredients, action.ingredientDeltas, -1),
        products: applyExpiryChange(
          applyProducedQty(state.products, action.producedProductId, action.producedQty, 1),
          action.producedProductId,
          expiryChange,
        ),
      };
      return upsertTaskOverride(
        withInventory,
        action.id,
        { productId: action.productId, date: action.date },
        { done: true, appliedCompletion: completion },
      );
    }
    case 'UNDO_AUTO_TASK_COMPLETION': {
      const override = state.taskOverrides.find((o) => o.id === action.id);
      const completion = override?.appliedCompletion;
      if (!override || !completion) return state;
      const withInventory: AppState = {
        ...state,
        ingredients: applyIngredientDeltas(state.ingredients, completion.ingredientDeltas, 1),
        products: revertExpiryChange(
          applyProducedQty(state.products, completion.producedProductId, completion.producedQty, -1),
          completion.producedProductId,
          completion.expiryChange,
        ),
      };
      return upsertTaskOverride(
        withInventory,
        action.id,
        { productId: override.productId, date: override.date },
        { done: false, appliedCompletion: undefined },
      );
    }
    case 'DISMISS_AUTO_TASK':
      return upsertTaskOverride(
        state,
        action.id,
        { productId: action.productId, date: action.date },
        { dismissed: true },
      );
    case 'SET_AUTO_TASK_PRIORITY':
      return upsertTaskOverride(
        state,
        action.id,
        { productId: action.productId, date: action.date },
        { priority: action.priority, priorityManual: true },
      );
    case 'SET_AUTO_TASK_ASSIGNEE':
      return upsertTaskOverride(
        state,
        action.id,
        { productId: action.productId, date: action.date },
        { assigneeId: action.assigneeId === null ? undefined : action.assigneeId },
      );

    case 'SET_DAY_PLAN_ENTRY': {
      const withEntry = upsertDayPlanEntry(state, action.date, action.entry);
      // Deliberately editing this product's plan for this date is a fresh action:
      // it should surface a task dismissed earlier today (getDisplayTasks still
      // hides it if the recomputed need is 0).
      const overrideId = autoTaskId(action.entry.productId, action.date);
      const dismissedOverride = withEntry.taskOverrides.find(
        (o) => o.id === overrideId && o.dismissed,
      );
      if (!dismissedOverride) return withEntry;
      return upsertTaskOverride(
        withEntry,
        overrideId,
        { productId: action.entry.productId, date: action.date },
        { dismissed: false },
      );
    }

    case 'ADD_SPECIAL_EVENT':
      return { ...state, specialEvents: [...state.specialEvents, action.event] };
    case 'UPDATE_SPECIAL_EVENT':
      return {
        ...state,
        specialEvents: state.specialEvents.map((e) =>
          e.id === action.event.id ? action.event : e,
        ),
      };
    case 'DELETE_SPECIAL_EVENT':
      return { ...state, specialEvents: state.specialEvents.filter((e) => e.id !== action.id) };

    case 'CARRY_OVER_TASKS':
      return carryOver(state, action.today);

    // Blank title or a duplicate id is a silent no-op: this op replays on every device, and a
    // reducer that throws would break replay everywhere, not just for whoever made the mistake.
    case 'ADD_RECURRING_TASK': {
      const title = action.rule.title.trim();
      const existing = state.recurringTasks ?? [];
      if (!title || existing.some((r) => r.id === action.rule.id)) return state;
      const withRule: AppState = {
        ...state,
        recurringTasks: [...existing, { ...action.rule, title, lastMaterialized: undefined }],
      };
      return materializeRecurring(withRule, action.today);
    }
    case 'UPDATE_RECURRING_TASK': {
      const title = action.rule.title.trim();
      const existing = state.recurringTasks ?? [];
      if (!title || !existing.some((r) => r.id === action.rule.id)) return state;
      // Editing changes what happens on *future* days; it must not reset which day was already
      // made, or saving a rule twice in one day would make today's task twice.
      return {
        ...state,
        recurringTasks: existing.map((r) =>
          r.id === action.rule.id ? { ...action.rule, title, lastMaterialized: r.lastMaterialized } : r,
        ),
      };
    }
    case 'DELETE_RECURRING_TASK': {
      if (!state.recurringTasks?.some((r) => r.id === action.id)) return state;
      return { ...state, recurringTasks: state.recurringTasks.filter((r) => r.id !== action.id) };
    }
    case 'MATERIALIZE_RECURRING':
      return materializeRecurring(state, action.today);

    case 'RESTORE_ENTITIES':
      return applyRestore(state, action.restore);

    case 'ADD_COOK':
      // A new cook has no history to catch up on: notices already posted count as read for them.
      return ackAllFor({ ...state, cooks: [...state.cooks, action.cook] }, action.cook.id);
    // A person correcting how their own name appears on tasks. Blank, unchanged or unknown is a
    // silent no-op for the same replay reason as RENAME_STATION below.
    case 'RENAME_COOK': {
      const name = action.name.trim().replace(/\s+/g, ' ');
      if (!name || name.length > 40) return state;
      if (!state.cooks.some((c) => c.id === action.id && c.name !== name)) return state;
      return { ...state, cooks: state.cooks.map((c) => (c.id === action.id ? { ...c, name } : c)) };
    }
    case 'DELETE_COOK':
      return { ...state, cooks: state.cooks.filter((c) => c.id !== action.id) };

    // Invalid input (empty name) or a name that already exists (case-insensitive) is a silent
    // no-op rather than a thrown error: this op replays deterministically on every device, and a
    // reducer that throws would break replay everywhere, not just for whoever made the mistake.
    case 'ADD_STATION': {
      const name = action.station.name.trim();
      if (!name) return state;
      const exists = state.stations.some((s) => s.name.trim().toLowerCase() === name.toLowerCase());
      if (exists) return state;
      return { ...state, stations: [...state.stations, { ...action.station, name }] };
    }

    case 'RENAME_STATION': {
      const name = action.name.trim();
      if (!name) return state;
      if (!state.stations.some((s) => s.id === action.id)) return state;
      const clash = state.stations.some(
        (s) => s.id !== action.id && s.name.trim().toLowerCase() === name.toLowerCase(),
      );
      if (clash) return state;
      return { ...state, stations: state.stations.map((s) => (s.id === action.id ? { ...s, name } : s)) };
    }

    // Recipes carry the station (`recipe.category`) and auto-tasks are derived from their recipe,
    // so re-pointing the recipes *is* moving the day's prep list. Free-text tasks carry their own
    // `categoryOverride`. Nothing is deleted but the station row itself. A station that is
    // already gone is a no-op, so replaying the op on a second device changes nothing.
    case 'SAVE_SUPPLIER': {
      const name = action.supplier.name.trim();
      if (!name) return state;
      const list = state.suppliers ?? [];
      // One card per name: saving a card under a name another card already has is refused (it
      // would make "which phone does this ingredient's supplier have?" ambiguous).
      if (list.some((x) => x.id !== action.supplier.id && x.name.trim() === name)) return state;
      const existing = list.find((x) => x.id === action.supplier.id);
      const next: Supplier = { ...action.supplier, name };
      const suppliers = existing ? list.map((x) => (x.id === next.id ? next : x)) : [...list, next];
      const oldName = existing?.name.trim();
      const ingredients =
        oldName && oldName !== name
          ? state.ingredients.map((i) => (i.supplier?.trim() === oldName ? { ...i, supplier: name } : i))
          : state.ingredients;
      return { ...state, suppliers, ingredients };
    }
    case 'DELETE_SUPPLIER': {
      if (!(state.suppliers ?? []).some((x) => x.id === action.id)) return state;
      return { ...state, suppliers: (state.suppliers ?? []).filter((x) => x.id !== action.id) };
    }
    case 'DELETE_STATION': {
      if (!state.stations.some((s) => s.id === action.id)) return state;
      const target =
        action.moveToId !== action.id && state.stations.some((s) => s.id === action.moveToId)
          ? action.moveToId
          : UNASSIGNED_CATEGORY;
      return {
        ...state,
        stations: state.stations.filter((s) => s.id !== action.id),
        recipes: state.recipes.map((r) => (r.category === action.id ? { ...r, category: target } : r)),
        tasks: state.tasks.map((t) =>
          t.categoryOverride === action.id ? { ...t, categoryOverride: target } : t,
        ),
      };
    }

    // A chef removed a teammate's access to the restaurant. Unassign that cook from any *open*
    // task/override so it doesn't sit stuck on someone who can no longer act on it, but leave
    // completed ones untouched — that's the history of who actually did the work.
    case 'REMOVE_COOK':
      return {
        ...state,
        cooks: state.cooks.filter((c) => c.id !== action.id),
        tasks: state.tasks.map((t) =>
          t.assigneeId === action.id && !t.done ? { ...t, assigneeId: undefined } : t,
        ),
        taskOverrides: state.taskOverrides.map((o) =>
          o.assigneeId === action.id && !o.done ? { ...o, assigneeId: undefined } : o,
        ),
      };

    case 'SET_EXPIRY':
      return action.itemType === 'ingredient'
        ? { ...state, ingredients: state.ingredients.map((i) => (i.id === action.id ? withExpiry(i, action.expiresOn) : i)) }
        : { ...state, products: state.products.map((p) => (p.id === action.id ? withExpiry(p, action.expiresOn) : p)) };

    case 'LOG_WASTE': {
      const { entry } = action;
      if (state.wasteLog?.some((e) => e.id === entry.id)) return state;
      let next = adjustStock(state, entry.itemType, entry.itemId, -entry.qty, entry.date);
      // An expired item that is now used up has nothing left to expire. A partial throw leaves the
      // rest still past its date, so the banner keeps asking about it.
      if (entry.reason === 'expired') {
        const left =
          entry.itemType === 'ingredient'
            ? next.ingredients.find((i) => i.id === entry.itemId)?.currentQty
            : next.products.find((p) => p.id === entry.itemId)?.currentQty;
        if (left !== undefined && left <= 0) {
          next =
            entry.itemType === 'ingredient'
              ? { ...next, ingredients: next.ingredients.map((i) => (i.id === entry.itemId ? withoutExpiry(i) : i)) }
              : { ...next, products: next.products.map((p) => (p.id === entry.itemId ? withoutExpiry(p) : p)) };
        }
      }
      return { ...next, wasteLog: [...(state.wasteLog ?? []), entry] };
    }
    case 'UNDO_WASTE': {
      const entry = state.wasteLog?.find((e) => e.id === action.id);
      if (!entry) return state;
      let next = adjustStock(state, entry.itemType, entry.itemId, entry.qty, entry.date);
      if (entry.expiredOn) {
        const restore = <T extends { id: string; expiresOn?: string }>(item: T): T =>
          item.id === entry.itemId && !item.expiresOn ? { ...item, expiresOn: entry.expiredOn } : item;
        next = entry.itemType === 'ingredient'
          ? { ...next, ingredients: next.ingredients.map(restore) }
          : { ...next, products: next.products.map(restore) };
      }
      return { ...next, wasteLog: (state.wasteLog ?? []).filter((e) => e.id !== action.id) };
    }

    case 'SET_ORDER_LINE_QTY':
      return upsertOrderLine(state, action.ingredientId, action.date, {
        qtyOverride: action.qtyOverride === null ? undefined : action.qtyOverride,
      });
    // An absolute set, not a toggle: two cooks tapping the same checkbox both land on the same
    // intended state instead of a toggle flipping it back and forth under concurrent writes.
    case 'SET_ORDER_LINE_ORDERED':
      return upsertOrderLine(state, action.ingredientId, action.date, { ordered: action.ordered });
    case 'SET_LINE_RECEIVED': {
      const line = state.orderLines.find((l) => l.ingredientId === action.ingredientId && l.date === action.date);
      if (!line || !line.ordered) return state;
      const next = Math.max(0, Math.round(action.receivedQty * 1000) / 1000);
      const delta = next - (line.receivedQty ?? 0);
      if (delta === 0) return state;
      return {
        ...state,
        ingredients: state.ingredients.map((i) =>
          i.id === action.ingredientId ? withQty(i, Math.round((i.currentQty + delta) * 1000) / 1000) : i,
        ),
        orderLines: state.orderLines.map((l) => {
          if (l !== line) return l;
          const { receivedQty: _previous, ...rest } = l;
          return next > 0 ? { ...rest, receivedQty: next } : rest;
        }),
      };
    }
    case 'RECEIVE_ORDER': {
      // Goods arrived: add exactly what the sheet said into stock and clear those rows, leaving
      // anything still on order (or on another date) untouched. Only receipts for lines still
      // open on this date are applied, so a retried or duplicated RECEIVE_ORDER (two cooks
      // tapping "קבלת סחורה" at once, or the same op replayed) can't add the same delivery twice.
      const openLineIds = new Set(
        state.orderLines.filter((l) => l.date === action.date).map((l) => l.ingredientId),
      );
      const openReceipts = action.receipts.filter((r) => openLineIds.has(r.ingredientId));
      if (openReceipts.length === 0) return state;
      const received = new Set(openReceipts.map((r) => r.ingredientId));
      return {
        ...state,
        ingredients: state.ingredients.map((i) => {
          const receipt = openReceipts.find((r) => r.ingredientId === i.id);
          return receipt ? withQty(i, i.currentQty + receipt.qty) : i;
        }),
        orderLines: state.orderLines.filter(
          (l) => !(l.date === action.date && received.has(l.ingredientId)),
        ),
      };
    }
    case 'CLEAR_ORDER_SHEET':
      return { ...state, orderLines: state.orderLines.filter((l) => l.date !== action.date) };
    case 'SUBMIT_ORDER': {
      let next = state;
      for (const line of action.lines) {
        next = upsertOrderLine(next, line.ingredientId, action.date, {
          qtyOverride: line.qty,
          ordered: true,
        });
      }
      return next;
    }

    case 'UPDATE_SETTINGS':
      return { ...state, settings: { ...state.settings, ...action.settings } };

    case 'IMPORT_STATE':
      return action.state;

    default:
      return state;
  }
}
