import { coverageColor, daysOfSupply, orderQtyForIngredient } from './calc';
import type { AppState, Ingredient } from '../types';

/**
 * The morning order's arithmetic, kept out of the screen so it can be tested — and so the screen,
 * the approve button's enabled state and `approve()` itself all read one function instead of each
 * re-deriving "what would this order contain".
 *
 * That last point is the bug this exists to prevent: the approve button used to be enabled by
 * "did the cook change a count" while `approve()` built its lines from something else entirely, so
 * an order that was complete and correct on arrival could not be sent without a made-up edit.
 */

/** Typed counts, keyed by ingredient id. Strings, because that is what an input holds mid-typing
 * ("", "1.", "-"); they are parsed only where a number is needed. */
export type CountDrafts = Record<string, string>;

/** `undefined` for anything that is not a usable quantity — empty, half-typed or negative. */
export function parseQty(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = parseFloat(raw);
  return Number.isNaN(n) || n < 0 ? undefined : n;
}

/** The count to calculate with: what is typed if it parses, else what is stored. */
export function effectiveCount(ingredient: Ingredient, drafts: CountDrafts): number {
  return parseQty(drafts[ingredient.id]) ?? ingredient.currentQty;
}

/** Counts that differ from the stored value — the only ones worth writing back. */
export function collectCountChanges(ingredients: Ingredient[], drafts: CountDrafts): { id: string; qty: number }[] {
  const changes: { id: string; qty: number }[] = [];
  for (const ing of ingredients) {
    const qty = parseQty(drafts[ing.id]);
    if (qty !== undefined && qty !== ing.currentQty) changes.push({ id: ing.id, qty });
  }
  return changes;
}

/** Today's manual quantity for an ingredient, if the chef typed one. */
export function orderOverride(state: AppState, ingredientId: string, date: string): number | undefined {
  return state.orderLines.find((l) => l.ingredientId === ingredientId && l.date === date)?.qtyOverride;
}

/**
 * What to order for one ingredient: the chef's own number if they typed one, otherwise the
 * suggestion — computed against the *typed* count, so counting the shelf immediately changes the
 * order beside it.
 */
export function suggestedQty(ingredient: Ingredient, state: AppState, date: string, drafts: CountDrafts): number {
  const override = orderOverride(state, ingredient.id, date);
  if (override !== undefined) return override;
  const count = effectiveCount(ingredient, drafts);
  // Cloning the ingredient list per row is O(n) work, so skip it when nothing was typed here —
  // which is nearly every row on a screen of fifty.
  const scoped =
    count === ingredient.currentQty
      ? state
      : { ...state, ingredients: state.ingredients.map((i) => (i.id === ingredient.id ? { ...i, currentQty: count } : i)) };
  const qty = Math.round(orderQtyForIngredient(ingredient.id, scoped) * 100) / 100;
  // A cook flagged it short and the numbers see no reason to order (usage data missing, or stock
  // looks fine on paper): the flag wins, with a floor of one par level so the line is worth sending.
  return isFlaggedShort(ingredient, count) && qty <= 0 ? shortFloor(ingredient, state) : qty;
}

/** Flagged short, and not since counted back up (a typed count above the stored one answers it). */
function isFlaggedShort(ingredient: Ingredient, count: number): boolean {
  return Boolean(ingredient.shortFlag) && count <= ingredient.currentQty;
}

/** What to order for something flagged short that the usual calculation says needs nothing:
 * its par level, else a day's cover, else one — never zero, or the flag would do nothing. */
function shortFloor(ingredient: Ingredient, state: AppState): number {
  const floor = ingredient.parLevel && ingredient.parLevel > 0 ? ingredient.parLevel : ingredient.dailyUsage * state.settings.defaultCoverageDays;
  return Math.round((floor > 0 ? floor : 1) * 100) / 100;
}

/** The order as it would be submitted right now. Empty only when there is genuinely nothing to
 * order — which is the single condition the approve button is disabled on. */
export function buildOrderLines(state: AppState, drafts: CountDrafts, date: string): { ingredientId: string; qty: number }[] {
  return state.ingredients
    .map((ing) => ({ ingredientId: ing.id, qty: suggestedQty(ing, state, date, drafts) }))
    .filter((l) => l.qty > 0);
}

/** A dot colour for an ingredient that is about to run out, or null when there is nothing to
 * flag. Plenty-of-stock rows deliberately carry no marker at all: on a list of fifty, the eye
 * should land only on what needs it. */
export function lowStockTone(ingredient: Ingredient, count: number, date: string): 'red' | 'yellow' | null {
  if (isFlaggedShort(ingredient, count)) return 'red';
  const days = daysOfSupply({ ...ingredient, currentQty: count }, date);
  if (!Number.isFinite(days)) return null;
  const tone = coverageColor(days);
  return tone === 'green' ? null : tone;
}

/**
 * "Fill to par": what the button would reset. Every hand-typed quantity for the day is dropped so
 * the suggestion (the larger of weekly need and par level, minus what is on the shelf) shows
 * again — and the previous values are returned so the same tap can be undone.
 *
 * Lines already marked ordered are left alone: their quantity is the order that went out to the
 * supplier, not a draft, and rewriting it would quietly change what a receiving cook checks the
 * delivery against.
 */
export function planFillToPar(state: AppState, date: string): { ingredientId: string; previous: number }[] {
  return state.orderLines
    .filter((l) => l.date === date && l.qtyOverride !== undefined && !l.ordered)
    .map((l) => ({ ingredientId: l.ingredientId, previous: l.qtyOverride as number }));
}
