import type { RecipeCategory } from '../types';

export const RECIPE_CATEGORIES: { value: RecipeCategory; label: string }[] = [
  { value: 'cold', label: 'פס קר' },
  { value: 'hot', label: 'פס חם' },
  { value: 'taboon', label: 'טאבון' },
  { value: 'dessert', label: 'קינוחים' },
  { value: 'general', label: 'כללי' },
];

export type CategoryFilter = RecipeCategory | 'all';

// "הכל" leads the row so browsing everything at once is the default, not a tab you have to
// find — the individual stations stay right beside it for narrowing down.
export const CATEGORY_TABS: { value: CategoryFilter; label: string }[] = [
  { value: 'all', label: 'הכל' },
  ...RECIPE_CATEGORIES,
];
