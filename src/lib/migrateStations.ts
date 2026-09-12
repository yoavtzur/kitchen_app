import type { AppState, Station } from '../types';

/** Hebrew labels for the categories the old hardcoded 5-value preset used to offer, so state
 * that already carries one of them keeps a real, correctly labeled station instead of an
 * orphaned string once the preset list is gone. */
const LEGACY_CATEGORY_LABELS: Record<string, string> = {
  cold: 'פס קר',
  hot: 'פס חם',
  taboon: 'טאבון',
  dessert: 'קינוחים',
};

type StationSource = Omit<AppState, 'stations'> & { stations?: Station[] };

/**
 * Backfills `stations` for state that predates the per-kitchen station list (schema v5).
 * Idempotent: state that already has a `stations` array is returned unchanged.
 *
 * This is not only the local-storage migration step (storage.ts's migrateV4toV5) — it is also
 * called directly on every Supabase snapshot bootstrap (sync/supabaseAdapter.ts). A restaurant's
 * `snapshots.state` jsonb blob has no schema-migration mechanism of its own: it's whatever the
 * last write left behind, which for any restaurant that existed before this feature shipped is a
 * schema-v4 shape with no `stations` key at all. Without this guard at the point that data enters
 * the app, `state.stations` would be `undefined` for every real signed-in account with existing
 * data, and every `stationOptions(state.stations)` call site crashes on `.map`.
 */
export function ensureStations(state: StationSource): AppState {
  if (Array.isArray(state.stations)) return state as AppState;
  const used = new Set<string>();
  for (const r of state.recipes ?? []) {
    if (r.category && r.category !== 'general') used.add(r.category);
  }
  for (const t of state.tasks ?? []) {
    if (t.categoryOverride && t.categoryOverride !== 'general') used.add(t.categoryOverride);
  }
  const now = new Date().toISOString();
  const stations: Station[] = [...used].map((id) => ({
    id,
    name: LEGACY_CATEGORY_LABELS[id] ?? id,
    createdAt: now,
  }));
  return { ...state, stations };
}
