import type {
  AppState,
  AutoTaskOverride,
  Cook,
  DayPlanEntry,
  Ingredient,
  OrderLine,
  Priority,
  Product,
  Recipe,
  Settings,
  SpecialEvent,
  Task,
  TaskCompletion,
  Unit,
  Weekday,
  WeekdayUsage,
} from '../types';
import { todayStr } from '../lib/date';
import { autoTaskId } from '../lib/tasks';
import { pruneEntities } from '../lib/integrity';
import { convert } from '../lib/units';

export type Action =
  | { type: 'SET_INGREDIENT_QTY'; id: string; qty: number }
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
  | { type: 'SET_PRODUCT_WEEKDAY_USAGE'; id: string; weekday: Weekday; dailyUsage?: number }
  | { type: 'ADD_PRODUCT'; product: Product }
  | { type: 'UPDATE_PRODUCT'; product: Product }
  | { type: 'DELETE_PRODUCT'; id: string }
  | { type: 'SAVE_PREP_ITEM'; recipe: Recipe; product: Product }
  | { type: 'ADD_RECIPE'; recipe: Recipe }
  | { type: 'UPDATE_RECIPE'; recipe: Recipe }
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
  | { type: 'ADD_COOK'; cook: Cook }
  | { type: 'DELETE_COOK'; id: string }
  | { type: 'SET_ORDER_LINE_QTY'; ingredientId: string; date: string; qtyOverride?: number | null }
  | { type: 'SET_ORDER_LINE_ORDERED'; ingredientId: string; date: string; ordered: boolean }
  | { type: 'RECEIVE_ORDER'; date: string; receipts: { ingredientId: string; qty: number }[] }
  | { type: 'CLEAR_ORDER_SHEET'; date: string }
  // Absolute set (idempotent under replay), mirroring SET_ORDER_LINE_ORDERED's own reasoning:
  // submits the whole current-day sheet as one op instead of one op per ingredient.
  | { type: 'SUBMIT_ORDER'; date: string; lines: { ingredientId: string; qty: number }[] }
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

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_INGREDIENT_QTY':
      return {
        ...state,
        ingredients: state.ingredients.map((i) =>
          i.id === action.id ? { ...i, currentQty: action.qty } : i,
        ),
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
          return update ? { ...i, currentQty: update.qty } : i;
        }),
      };
      for (const update of action.products) {
        next = applyProductQtyUpdate(next, update.id, update.qty, action.today);
      }
      return next;
    }
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
        products: state.products.map((p) => (p.id === action.product.id ? action.product : p)),
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
          ? state.products.map((p) => (p.id === action.product.id ? action.product : p))
          : [...state.products, action.product],
      };
      const hasRecipe = withProduct.recipes.some((r) => r.id === action.recipe.id);
      const withRecipe: AppState = {
        ...withProduct,
        recipes: hasRecipe
          ? withProduct.recipes.map((r) => (r.id === action.recipe.id ? action.recipe : r))
          : [...withProduct.recipes, action.recipe],
      };
      return linkRecipeProduct(withRecipe, action.recipe.id, action.product.id);
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
      return linkRecipeProduct(withRecipe, action.recipe.id, action.recipe.producesProductId);
    }
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
      const completion: TaskCompletion = {
        ingredientDeltas: action.ingredientDeltas,
        producedProductId: action.producedProductId,
        producedQty: action.producedQty,
      };
      return {
        ...state,
        ingredients: applyIngredientDeltas(state.ingredients, action.ingredientDeltas, -1),
        products: applyProducedQty(state.products, action.producedProductId, action.producedQty, 1),
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
        products: applyProducedQty(state.products, completion.producedProductId, completion.producedQty, -1),
        tasks: state.tasks.map((t) =>
          t.id === action.id ? { ...t, done: false, appliedCompletion: undefined } : t,
        ),
      };
    }

    case 'CONFIRM_AUTO_TASK_COMPLETION': {
      // Same idempotency guard as CONFIRM_TASK_COMPLETION, keyed on the override row.
      const existingOverride = state.taskOverrides.find((o) => o.id === action.id);
      if (existingOverride?.done) return state;
      const completion: TaskCompletion = {
        ingredientDeltas: action.ingredientDeltas,
        producedProductId: action.producedProductId,
        producedQty: action.producedQty,
      };
      const withInventory: AppState = {
        ...state,
        ingredients: applyIngredientDeltas(state.ingredients, action.ingredientDeltas, -1),
        products: applyProducedQty(state.products, action.producedProductId, action.producedQty, 1),
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
        products: applyProducedQty(state.products, completion.producedProductId, completion.producedQty, -1),
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

    case 'ADD_COOK':
      return { ...state, cooks: [...state.cooks, action.cook] };
    case 'DELETE_COOK':
      return { ...state, cooks: state.cooks.filter((c) => c.id !== action.id) };

    case 'SET_ORDER_LINE_QTY':
      return upsertOrderLine(state, action.ingredientId, action.date, {
        qtyOverride: action.qtyOverride === null ? undefined : action.qtyOverride,
      });
    // An absolute set, not a toggle: two cooks tapping the same checkbox both land on the same
    // intended state instead of a toggle flipping it back and forth under concurrent writes.
    case 'SET_ORDER_LINE_ORDERED':
      return upsertOrderLine(state, action.ingredientId, action.date, { ordered: action.ordered });
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
          return receipt ? { ...i, currentQty: i.currentQty + receipt.qty } : i;
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
