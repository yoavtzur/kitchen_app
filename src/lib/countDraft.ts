import { COUNT_DRAFT_KEY } from './resetLocalData';

/**
 * A stock count in progress, kept on this device until "שמור ספירה".
 *
 * The stock screen unmounts on every navigation, so a count held only in `useState` was lost the
 * moment a cook opened another tab mid-walk-through. Stock itself still changes only on save (a
 * count is one decision, not fifty), so the half-done count lives in `localStorage` — a device
 * draft, never synced: another cook's screen must not fill with numbers nobody has confirmed.
 *
 * Each entry remembers the stored quantity it was typed against (`base`). If that quantity has
 * moved since (another device counted, a delivery arrived), the row is flagged rather than
 * silently overwritten on save.
 */

export type DraftEntry = { value: string; base: number };
export type DraftMap = Record<string, DraftEntry>;
export type CountDraft = {
  /** Which kitchen this count belongs to: a draft must never land on a different restaurant. */
  scope: string;
  ingredients: DraftMap;
  products: DraftMap;
};

type Item = { id: string; currentQty: number };

export function emptyDraft(scope: string): CountDraft {
  return { scope, ingredients: {}, products: {} };
}

function isEntry(v: unknown): v is DraftEntry {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as DraftEntry).value === 'string' &&
    typeof (v as DraftEntry).base === 'number'
  );
}

function cleanMap(v: unknown): DraftMap {
  if (typeof v !== 'object' || v === null) return {};
  const out: DraftMap = {};
  for (const [k, e] of Object.entries(v)) if (isEntry(e)) out[k] = { value: e.value, base: e.base };
  return out;
}

/** Parses what was stored; anything malformed, or from another kitchen, is an empty draft. */
export function parseDraft(raw: string | null, scope: string): CountDraft {
  if (!raw) return emptyDraft(scope);
  try {
    const parsed = JSON.parse(raw) as Partial<CountDraft>;
    if (!parsed || parsed.scope !== scope) return emptyDraft(scope);
    return { scope, ingredients: cleanMap(parsed.ingredients), products: cleanMap(parsed.products) };
  } catch {
    return emptyDraft(scope);
  }
}

/** Drops entries for items that no longer exist (deleted on another device). */
export function pruneMap(map: DraftMap, items: Item[]): DraftMap {
  const ids = new Set(items.map((i) => i.id));
  const out: DraftMap = {};
  for (const [id, e] of Object.entries(map)) if (ids.has(id)) out[id] = e;
  return out;
}

export function draftSize(draft: CountDraft): number {
  return Object.keys(draft.ingredients).length + Object.keys(draft.products).length;
}

/** The typed value as a number, or undefined while it is not one (empty, "1.", "abc"). */
export function draftQty(entry: DraftEntry | undefined): number | undefined {
  if (!entry) return undefined;
  const n = parseFloat(entry.value);
  return Number.isNaN(n) || n < 0 ? undefined : n;
}

/** Entries that would actually change stock: parse, and differ from what is stored now. */
export function changesIn(map: DraftMap, items: Item[]): { id: string; qty: number }[] {
  const out: { id: string; qty: number }[] = [];
  for (const item of items) {
    const qty = draftQty(map[item.id]);
    if (qty !== undefined && qty !== item.currentQty) out.push({ id: item.id, qty });
  }
  return out;
}

/** Ids whose stored quantity has moved since the count was typed. */
export function movedSince(map: DraftMap, items: Item[]): Set<string> {
  const out = new Set<string>();
  for (const item of items) {
    const e = map[item.id];
    if (e && e.base !== item.currentQty) out.add(item.id);
  }
  return out;
}

export function setEntry(map: DraftMap, id: string, value: string, currentQty: number): DraftMap {
  // `base` is fixed at the first keystroke on this row: re-typing must not hide that the stored
  // number moved underneath it in between.
  const base = map[id]?.base ?? currentQty;
  return { ...map, [id]: { value, base } };
}

export function removeEntry(map: DraftMap, id: string): DraftMap {
  if (!(id in map)) return map;
  const next = { ...map };
  delete next[id];
  return next;
}

export function loadDraft(scope: string): CountDraft {
  try {
    return parseDraft(localStorage.getItem(COUNT_DRAFT_KEY), scope);
  } catch {
    return emptyDraft(scope);
  }
}

export function storeDraft(draft: CountDraft): void {
  try {
    if (draftSize(draft) === 0) localStorage.removeItem(COUNT_DRAFT_KEY);
    else localStorage.setItem(COUNT_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // storage unavailable (private mode): the count simply lasts as long as the screen
  }
}
