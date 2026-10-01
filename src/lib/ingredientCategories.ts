import type { Ingredient } from '../types';

/** The label for ingredients with no category, and the value its tab carries. */
export const NO_CATEGORY = 'ללא קטגוריה';
export const ALL_CATEGORIES = 'all';

export function categoryOf(ingredient: Pick<Ingredient, 'category'>): string {
  return ingredient.category?.trim() || NO_CATEGORY;
}

/**
 * Tabs for browsing ingredients by the shelf they live on (יבשים, ירקות, בשר, חלב).
 *
 * Built from what exists, never from a fixed list: a tab for an empty category is a dead end, so
 * a category appears only while at least one ingredient carries it. "הכל" always leads, and "ללא
 * קטגוריה" comes last and only when something actually has none — it is a to-do, not a shelf.
 */
export function ingredientCategoryTabs(ingredients: Pick<Ingredient, 'category'>[]): { value: string; label: string }[] {
  const categories = new Set<string>();
  for (const ing of ingredients) categories.add(categoryOf(ing));
  const named = [...categories].filter((c) => c !== NO_CATEGORY).sort((a, b) => a.localeCompare(b, 'he'));
  const tabs = [{ value: ALL_CATEGORIES, label: 'הכל' }, ...named.map((c) => ({ value: c, label: c }))];
  if (categories.has(NO_CATEGORY)) tabs.push({ value: NO_CATEGORY, label: NO_CATEGORY });
  return tabs;
}

export function matchesCategory(ingredient: Pick<Ingredient, 'category'>, category: string): boolean {
  return category === ALL_CATEGORIES || categoryOf(ingredient) === category;
}

/** The distinct, trimmed categories in use — the suggestions offered when editing one. */
export function existingCategories(ingredients: Pick<Ingredient, 'category'>[]): string[] {
  const seen = new Set<string>();
  for (const ing of ingredients) {
    const c = ing.category?.trim();
    if (c) seen.add(c);
  }
  return [...seen].sort((a, b) => a.localeCompare(b, 'he'));
}

const key = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/**
 * Category is free text, so "ירקות", "ירקות " and "ירקות" typed on another day would each become
 * their own tab. This folds spacing and case onto the spelling already in use: typing a variant
 * of an existing category yields that category, anything else is kept (tidied) as a new one.
 *
 * It deliberately does not try to know that "ירק" and "ירקות" are the same word. A guess like that
 * would silently merge two things a chef meant to keep apart; the suggestions in the field are
 * what steer the chef to the existing spelling instead.
 */
export function normalizeCategory(input: string, existing: string[]): string {
  const tidy = input.trim().replace(/\s+/g, ' ');
  if (!tidy) return '';
  const match = existing.find((e) => key(e) === key(tidy));
  return match ?? tidy;
}
