import type { Ingredient, Product, RecipeItem, Unit } from '../types';
import type { ScannedRecipe } from './geminiScanner';

/**
 * Turns a scanned (name-based) recipe into the shape `RecipeEditor` opens with.
 *
 * Pure — no store, no dispatch, no network. Nothing here creates an ingredient: a name the
 * kitchen doesn't have yet is marked with `NEW_INGREDIENT_REF` and carries `newIngredientName`,
 * which is exactly the sentinel `RecipeEditor` already uses for "ingredient the cook typed by
 * hand", created via ADD_INGREDIENT only when they press save. So an AI scan can never write
 * anything to the kitchen's data on its own.
 */

/** Mirrors RecipeEditor's own sentinel for an ingredient that doesn't exist yet. */
export const NEW_INGREDIENT_REF = '__new__';

export type RecipeDraftItem = RecipeItem & {
  /** Set only when `refId === NEW_INGREDIENT_REF`: the name read off the page. */
  newIngredientName?: string;
  /** The ingredient line verbatim, shown to the cook so they can check the AI against the photo. */
  sourceLine?: string;
};

export type RecipeDraft = {
  name: string;
  yieldQty: number;
  yieldUnit: Unit;
  items: RecipeDraftItem[];
  steps: string[];
  /** Ingredient names that matched nothing in this kitchen and will be created on save. */
  newIngredientNames: string[];
};

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

type Match = { refType: RecipeItem['refType']; refId: string; unit: Unit };

/**
 * Resolves a written ingredient name against the kitchen's own rows: exact match first, then a
 * containment match in either direction ("עגבניות שרי" on the page vs. "עגבניות" in stock).
 * Ingredients win over products, since a recipe line normally names a raw good.
 */
function findMatch(name: string, ingredients: Ingredient[], products: Product[]): Match | null {
  const target = normalizeName(name);
  if (!target) return null;

  for (const ing of ingredients) {
    if (normalizeName(ing.name) === target) return { refType: 'ingredient', refId: ing.id, unit: ing.unit };
  }
  for (const prod of products) {
    if (normalizeName(prod.name) === target) return { refType: 'product', refId: prod.id, unit: prod.unit };
  }

  for (const ing of ingredients) {
    const candidate = normalizeName(ing.name);
    if (candidate && (candidate.includes(target) || target.includes(candidate))) {
      return { refType: 'ingredient', refId: ing.id, unit: ing.unit };
    }
  }
  for (const prod of products) {
    const candidate = normalizeName(prod.name);
    if (candidate && (candidate.includes(target) || target.includes(candidate))) {
      return { refType: 'product', refId: prod.id, unit: prod.unit };
    }
  }
  return null;
}

/** Default unit for a brand-new ingredient, matching RecipeEditor's own "+ מצרך חדש" default. */
const NEW_INGREDIENT_UNIT: Unit = 'kg';

/**
 * @param scanned  what `parseRecipeFromImage` read off the photo
 * @param catalog  the kitchen's current ingredients and products, for name resolution
 */
export function scannedToDraft(
  scanned: ScannedRecipe,
  catalog: { ingredients: Ingredient[]; products: Product[] },
): RecipeDraft {
  const items: RecipeDraftItem[] = [];
  const newIngredientNames: string[] = [];

  for (const line of scanned.ingredients) {
    const match = findMatch(line.name, catalog.ingredients, catalog.products);
    // A unit the page didn't state (or stated as cups/spoons) falls back to the matched item's
    // own stock unit — the same default RecipeEditor applies when an item is picked by hand.
    const unit = line.unit ?? match?.unit ?? NEW_INGREDIENT_UNIT;
    if (match) {
      items.push({ refType: match.refType, refId: match.refId, qty: line.qty ?? 0, unit, sourceLine: line.raw });
    } else {
      items.push({
        refType: 'ingredient',
        refId: NEW_INGREDIENT_REF,
        qty: line.qty ?? 0,
        unit,
        newIngredientName: line.name,
        sourceLine: line.raw,
      });
      newIngredientNames.push(line.name);
    }
  }

  // The app stores a batch yield, not servings. A stated yield wins; "4 מנות" is the honest
  // fallback (4 countable units); otherwise 1 batch, which is RecipeEditor's own default.
  const yieldFromServings = scanned.servings !== null && scanned.servings > 0;
  const yieldQty = scanned.yieldQty ?? (yieldFromServings ? scanned.servings! : 1);
  const yieldUnit = scanned.yieldUnit ?? (yieldFromServings ? 'unit' : 'unit');

  return {
    name: scanned.name,
    yieldQty,
    yieldUnit,
    items,
    steps: scanned.steps,
    newIngredientNames,
  };
}
