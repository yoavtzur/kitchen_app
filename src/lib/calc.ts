import type {
  AppState,
  DayPlan,
  Priority,
  Product,
  Recipe,
  RecipeItem,
  RoundTo,
  SpecialEvent,
  Unit,
  WeekdayUsage,
} from '../types';
import { convert } from './units';
import { dayOfWeek } from './date';

function findDayPlan(dayPlans: DayPlan[], date: string): DayPlan | undefined {
  return dayPlans.find((p) => p.date === date);
}

/** Resolves a dailyUsage figure for a specific date: the weekday override for that date's
 * day of week if one is set, otherwise the base value. */
export function weekdayValue(base: number, overrides: WeekdayUsage | undefined, date: string): number {
  if (!overrides) return base;
  return overrides[dayOfWeek(date)] ?? base;
}

function eventExtrasFor(events: SpecialEvent[], date: string, productId: string): number {
  return events
    .filter((e) => e.date === date)
    .flatMap((e) => e.extras)
    .filter((ex) => ex.productId === productId)
    .reduce((sum, ex) => sum + ex.extraQty, 0);
}

/** Required quantity of a product for a given date: manual override, else dailyUsage + special-event extras. */
export function requiredQty(
  product: Product,
  date: string,
  dayPlans: DayPlan[],
  events: SpecialEvent[],
): number {
  const plan = findDayPlan(dayPlans, date);
  const entry = plan?.entries.find((e) => e.productId === product.id);
  const extras = eventExtrasFor(events, date, product.id);
  if (entry?.requiredQty !== undefined) return entry.requiredQty + extras;
  return weekdayValue(product.dailyUsage, product.dailyUsageByWeekday, date) + extras;
}

function coverageDaysFor(product: Product, defaultCoverageDays: number): number {
  return product.coverageDaysOverride ?? defaultCoverageDays;
}

/** Quantity that needs to be prepared today: manual prep override, else max(0, required*coverageDays - currentQty). */
export function toPrepare(
  product: Product,
  date: string,
  state: Pick<AppState, 'dayPlans' | 'specialEvents' | 'settings'>,
): number {
  const plan = findDayPlan(state.dayPlans, date);
  const entry = plan?.entries.find((e) => e.productId === product.id);
  if (entry?.prepOverride !== undefined) return entry.prepOverride;

  const required = requiredQty(product, date, state.dayPlans, state.specialEvents);
  const coverageDays = coverageDaysFor(product, state.settings.defaultCoverageDays);
  return Math.max(0, required * coverageDays - product.currentQty);
}

function roundMultiplier(value: number, roundTo: RoundTo): number {
  if (value === 0) return 0;
  if (roundTo === null || roundTo === undefined) return value;
  return Math.ceil(value / roundTo) * roundTo;
}

/** Recipe multiplier needed to produce `qtyNeeded` expressed in the recipe's own yield unit. */
export function recipeMultiplier(recipe: Recipe, qtyNeeded: number, roundTo: RoundTo): number {
  if (recipe.yieldQty <= 0) return 0;
  const raw = qtyNeeded / recipe.yieldQty;
  return roundMultiplier(raw, roundTo);
}

export type ProductMultiplier = {
  multiplier: number;
  /** True when the product's stock unit cannot be converted to the recipe's yield unit
   * (e.g. litres vs. pieces) — the multiplier is then 0 rather than a silently wrong number. */
  unitMismatch: boolean;
};

/**
 * Multiplier needed to produce `qtyNeeded` of `product`, where `qtyNeeded` is in the
 * PRODUCT's stock unit and the recipe yields in its own unit. Converts between the two
 * instead of dividing raw numbers (a kg product made by a recipe yielding grams was
 * previously off by a factor of 1000).
 */
export function multiplierForProduct(
  product: Pick<Product, 'unit'>,
  recipe: Recipe,
  qtyNeeded: number,
  roundTo: RoundTo,
): ProductMultiplier {
  const inYieldUnit = convert(qtyNeeded, product.unit, recipe.yieldUnit);
  if (inYieldUnit === null) return { multiplier: 0, unitMismatch: true };
  return { multiplier: recipeMultiplier(recipe, inYieldUnit, roundTo), unitMismatch: false };
}

/** Priority color for a product on a given date. */
export function priorityFor(
  product: Product,
  date: string,
  state: Pick<AppState, 'dayPlans' | 'specialEvents' | 'settings'>,
): Priority {
  const required = requiredQty(product, date, state.dayPlans, state.specialEvents);
  if (product.currentQty < required) return 'red';
  const coverageDays = coverageDaysFor(product, state.settings.defaultCoverageDays);
  if (product.currentQty < required * coverageDays) return 'yellow';
  return 'green';
}

export type ExplodedLine = {
  refType: 'ingredient' | 'product';
  refId: string;
  name: string;
  qty: number;
  unit: Unit;
  unresolvedUnit?: boolean;
};

/**
 * Multiplies each recipe item by `multiplier`, recursively expanding any item that
 * refers to a component product with its own recipe (guards against cycles).
 */
export function explodeIngredients(
  recipe: Recipe,
  multiplier: number,
  state: Pick<AppState, 'recipes' | 'ingredients' | 'products'>,
  seenRecipeIds: Set<string> = new Set(),
): ExplodedLine[] {
  if (seenRecipeIds.has(recipe.id)) return [];
  const nextSeen = new Set(seenRecipeIds).add(recipe.id);

  const lines: ExplodedLine[] = [];
  for (const item of recipe.items) {
    const scaledQty = item.qty * multiplier;
    if (item.refType === 'ingredient') {
      const ing = state.ingredients.find((i) => i.id === item.refId);
      lines.push({
        refType: 'ingredient',
        refId: item.refId,
        name: ing?.name ?? item.refId,
        qty: scaledQty,
        unit: item.unit,
        unresolvedUnit: ing ? !canUseUnit(ing.unit, item.unit) : false,
      });
    } else {
      const prod = state.products.find((p) => p.id === item.refId);
      const subRecipe = prod?.recipeId
        ? state.recipes.find((r) => r.id === prod.recipeId)
        : undefined;
      // The item quantity is written in `item.unit`, but the sub-recipe yields in its own
      // unit — convert before dividing, and stop the recursion if the units are unrelated.
      const qtyInYieldUnit = subRecipe ? convert(scaledQty, item.unit, subRecipe.yieldUnit) : null;
      if (subRecipe && qtyInYieldUnit !== null) {
        const subMultiplier = subRecipe.yieldQty > 0 ? qtyInYieldUnit / subRecipe.yieldQty : 0;
        lines.push(
          ...explodeIngredients(subRecipe, subMultiplier, state, nextSeen),
        );
      } else {
        lines.push({
          refType: 'product',
          refId: item.refId,
          name: prod?.name ?? item.refId,
          qty: scaledQty,
          unit: item.unit,
          unresolvedUnit: subRecipe ? true : undefined,
        });
      }
    }
  }
  return lines;
}

function canUseUnit(stockUnit: Unit, recipeUnit: Unit): boolean {
  return convert(1, recipeUnit, stockUnit) !== null;
}

export type WeightedRecipeLine = {
  refType: RecipeItem['refType'];
  refId: string;
  name: string;
  qty: number;
  unit: Unit;
  unresolvedUnit?: boolean;
};

/** Non-recursive scaled view of a recipe's own items, for display inside a task (original recipe is untouched). */
export function weightedRecipeItems(
  recipe: Recipe,
  multiplier: number,
  state: Pick<AppState, 'ingredients' | 'products'>,
): WeightedRecipeLine[] {
  return recipe.items.map((item) => {
    const scaledQty = item.qty * multiplier;
    if (item.refType === 'ingredient') {
      const ing = state.ingredients.find((i) => i.id === item.refId);
      return {
        refType: item.refType,
        refId: item.refId,
        name: ing?.name ?? item.refId,
        qty: scaledQty,
        unit: item.unit,
        unresolvedUnit: ing ? !canUseUnit(ing.unit, item.unit) : false,
      };
    }
    const prod = state.products.find((p) => p.id === item.refId);
    return {
      refType: item.refType,
      refId: item.refId,
      name: prod?.name ?? item.refId,
      qty: scaledQty,
      unit: item.unit,
    };
  });
}

/** Weekly need for an ingredient: explicit weeklyUsage if set, else derived from all products' weeklyTarget via their recipes. */
export function weeklyNeedForIngredient(
  ingredientId: string,
  state: Pick<AppState, 'ingredients' | 'products' | 'recipes'>,
): number {
  const ing = state.ingredients.find((i) => i.id === ingredientId);
  if (!ing) return 0;
  if (ing.weeklyUsage > 0) return ing.weeklyUsage;

  let total = 0;
  for (const product of state.products) {
    if (!product.recipeId || product.weeklyTarget <= 0) continue;
    const recipe = state.recipes.find((r) => r.id === product.recipeId);
    if (!recipe || recipe.yieldQty <= 0) continue;
    // weeklyTarget is in the product's stock unit; the recipe yields in its own unit.
    const targetInYieldUnit = convert(product.weeklyTarget, product.unit, recipe.yieldUnit);
    if (targetInYieldUnit === null) continue;
    const multiplier = targetInYieldUnit / recipe.yieldQty;
    const exploded = explodeIngredients(recipe, multiplier, state);
    for (const line of exploded) {
      if (line.refType === 'ingredient' && line.refId === ingredientId) {
        const converted = convert(line.qty, line.unit, ing.unit);
        total += converted ?? 0;
      }
    }
  }
  return total;
}

/** Suggested order quantity: top the stock up to the larger of the weekly need and the par level. */
export function orderQtyForIngredient(
  ingredientId: string,
  state: Pick<AppState, 'ingredients' | 'products' | 'recipes'>,
): number {
  const ing = state.ingredients.find((i) => i.id === ingredientId);
  if (!ing) return 0;
  const need = Math.max(weeklyNeedForIngredient(ingredientId, state), ing.parLevel ?? 0);
  return Math.max(0, need - ing.currentQty);
}

/**
 * Days of stock remaining. Pass `date` to resolve that day's weekday-specific usage
 * (e.g. tomatoes run out faster on a Friday); omitted, it falls back to the base dailyUsage.
 */
export function daysOfSupply(
  ing: { currentQty: number; dailyUsage: number; dailyUsageByWeekday?: WeekdayUsage },
  date?: string,
): number {
  const daily = date ? weekdayValue(ing.dailyUsage, ing.dailyUsageByWeekday, date) : ing.dailyUsage;
  if (daily <= 0) return Infinity;
  return ing.currentQty / daily;
}

/** Coverage pill color for a days-of-supply figure: under a day is urgent, under 3 is a heads-up. */
export function coverageColor(days: number): 'red' | 'yellow' | 'green' {
  if (days < 1) return 'red';
  if (days < 3) return 'yellow';
  return 'green';
}
