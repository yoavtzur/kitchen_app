import { describe, expect, it } from 'vitest';
import {
  ALL_CATEGORIES,
  NO_CATEGORY,
  existingCategories,
  ingredientCategoryTabs,
  matchesCategory,
  normalizeCategory,
} from '../ingredientCategories';

const ing = (category?: string) => ({ category });

describe('ingredientCategoryTabs', () => {
  it('always starts with "הכל", even with no ingredients', () => {
    expect(ingredientCategoryTabs([])).toEqual([{ value: ALL_CATEGORIES, label: 'הכל' }]);
  });

  it('lists only categories that have an ingredient, sorted', () => {
    const tabs = ingredientCategoryTabs([ing('ירקות'), ing('בשר'), ing('ירקות')]);
    expect(tabs.map((t) => t.label)).toEqual(['הכל', 'בשר', 'ירקות']);
  });

  it('puts "ללא קטגוריה" last, and only when something has no category', () => {
    expect(ingredientCategoryTabs([ing('ירקות'), ing(undefined), ing('  ')]).map((t) => t.label)).toEqual([
      'הכל',
      'ירקות',
      NO_CATEGORY,
    ]);
    expect(ingredientCategoryTabs([ing('ירקות')]).map((t) => t.label)).not.toContain(NO_CATEGORY);
  });

  it('never produces an empty tab', () => {
    const items = [ing('ירקות'), ing('בשר'), ing(undefined)];
    const tabs = ingredientCategoryTabs(items);
    for (const tab of tabs) {
      if (tab.value !== ALL_CATEGORIES) expect(items.some((i) => matchesCategory(i, tab.value))).toBe(true);
    }
  });
});

describe('matchesCategory', () => {
  it('matches everything for "all"', () => {
    expect(matchesCategory(ing('ירקות'), ALL_CATEGORIES)).toBe(true);
    expect(matchesCategory(ing(undefined), ALL_CATEGORIES)).toBe(true);
  });

  it('matches a trimmed category, and uncategorised items under the no-category tab', () => {
    expect(matchesCategory(ing(' ירקות '), 'ירקות')).toBe(true);
    expect(matchesCategory(ing(undefined), NO_CATEGORY)).toBe(true);
    expect(matchesCategory(ing('בשר'), 'ירקות')).toBe(false);
  });
});

describe('existingCategories', () => {
  it('returns distinct trimmed categories, skipping blanks', () => {
    expect(existingCategories([ing('ירקות '), ing('ירקות'), ing(''), ing(undefined), ing('בשר')])).toEqual([
      'בשר',
      'ירקות',
    ]);
  });
});

describe('normalizeCategory', () => {
  const existing = ['ירקות', 'Dry Goods'];

  it('folds spacing and case onto the spelling already in use', () => {
    expect(normalizeCategory('  ירקות ', existing)).toBe('ירקות');
    expect(normalizeCategory('dry   goods', existing)).toBe('Dry Goods');
    expect(normalizeCategory('DRYGOODS', existing)).toBe('Dry Goods');
  });

  it('keeps a genuinely new category, tidied', () => {
    expect(normalizeCategory('  חלב   וביצים ', existing)).toBe('חלב וביצים');
  });

  it('does not guess that a singular and a plural are the same word', () => {
    expect(normalizeCategory('ירק', existing)).toBe('ירק');
  });

  it('returns empty for blank input, which clears the category', () => {
    expect(normalizeCategory('   ', existing)).toBe('');
  });
});
