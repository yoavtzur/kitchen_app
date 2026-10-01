import type { AppState, Recipe, RecipeChange, RecipeNotice } from '../types';

/**
 * "The chef changed a recipe — read it before you start": the data side of the gate that stops a
 * cook from seeing today's tasks until they have said they understood.
 *
 * It is derived, not authored. Nobody writes a notice; saving a recipe whose *content* changed
 * leaves one behind, so the chef cannot forget to warn the line and a cook cannot miss a change
 * that was made. That is also why it needs no new permission or server rule: editing a recipe is
 * already gated by `can_edit_recipes` in `append_ops`, and acknowledging is open to any member.
 *
 * Deterministic on purpose (no clock, no random id): the same ops replayed on any device produce
 * the same notices. A per-recipe revision counter stands in for both — a cook's acknowledgement
 * names the revision they read, so a later edit makes the notice pending again.
 */

export const CHANGE_LABELS: Record<RecipeChange, string> = {
  name: 'שם',
  items: 'מצרכים וכמויות',
  steps: 'שלבי הכנה',
  yield: 'כמות תוצרת',
};

/** What differs between two versions of a recipe, as far as a cook doing the prep would care.
 * Station (`category`) and the product link are deliberately not here: moving a recipe between
 * stations changes where it is listed, not how it is made. */
export function recipeChanges(before: Recipe, after: Recipe): RecipeChange[] {
  const out: RecipeChange[] = [];
  if (before.name.trim() !== after.name.trim()) out.push('name');
  if (JSON.stringify(before.items) !== JSON.stringify(after.items)) out.push('items');
  if (JSON.stringify(before.steps) !== JSON.stringify(after.steps)) out.push('steps');
  if (before.yieldQty !== after.yieldQty || before.yieldUnit !== after.yieldUnit) out.push('yield');
  return out;
}

/** Records a content change to a recipe that already existed. A no-op when nothing a cook would
 * care about changed. The editor is marked as having read it — they just wrote it. */
export function noteRecipeChange(state: AppState, before: Recipe | undefined, after: Recipe, byCookId?: string): AppState {
  if (!before) return state;
  const changed = recipeChanges(before, after);
  if (changed.length === 0) return state;
  const previous = state.recipeNotices?.[after.id];
  const notice: RecipeNotice = {
    rev: (previous?.rev ?? 0) + 1,
    // Changes pile up until every cook has read them: two edits before anyone looked are one notice.
    changed: [...new Set([...(previous && state.cooks.some((c) => !previous.ackedBy.includes(c.id)) ? previous.changed : []), ...changed])],
    ackedBy: byCookId ? [byCookId] : [],
  };
  return { ...state, recipeNotices: { ...state.recipeNotices, [after.id]: notice } };
}

/** `cookId` has read revision `rev`. Ignored if that is not the current revision — acknowledging
 * an old change must not clear a newer one the cook has not seen. */
export function ackRecipeNotice(state: AppState, recipeId: string, rev: number, cookId: string): AppState {
  const notice = state.recipeNotices?.[recipeId];
  if (!notice || notice.rev !== rev || notice.ackedBy.includes(cookId)) return state;
  return {
    ...state,
    recipeNotices: { ...state.recipeNotices, [recipeId]: { ...notice, ackedBy: [...notice.ackedBy, cookId] } },
  };
}

/** A cook who joins now has no history to catch up on: everything already posted counts as read. */
export function ackAllFor(state: AppState, cookId: string): AppState {
  const notices = state.recipeNotices;
  if (!notices) return state;
  const next: Record<string, RecipeNotice> = {};
  for (const [id, n] of Object.entries(notices)) {
    next[id] = n.ackedBy.includes(cookId) ? n : { ...n, ackedBy: [...n.ackedBy, cookId] };
  }
  return { ...state, recipeNotices: next };
}

export type PendingNotice = { recipeId: string; recipeName: string; rev: number; changed: RecipeChange[] };

/** What `cookId` still has to read, by recipe name. A deleted recipe has nothing left to read. */
export function pendingNoticesFor(state: AppState, cookId: string): PendingNotice[] {
  const out: PendingNotice[] = [];
  for (const [recipeId, notice] of Object.entries(state.recipeNotices ?? {})) {
    if (notice.ackedBy.includes(cookId)) continue;
    const recipe = state.recipes.find((r) => r.id === recipeId);
    if (!recipe) continue;
    out.push({ recipeId, recipeName: recipe.name, rev: notice.rev, changed: notice.changed });
  }
  return out.sort((a, b) => a.recipeName.localeCompare(b.recipeName, 'he'));
}
