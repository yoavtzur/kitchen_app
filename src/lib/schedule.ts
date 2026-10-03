import type { AppState, StationShift } from '../types';

/**
 * The work schedule: which cook works which station on which day (`AppState.stationShifts`).
 *
 * It assigns by default, never by force: a station's task that day with nobody chosen by hand
 * shows as the scheduled cook's (`getDisplayTasks`), and choosing someone on the task still wins.
 * Nothing is written onto the tasks themselves, so changing the schedule re-assigns every
 * untouched task at once, and a cook taken off the schedule takes nothing with them.
 */

/** The cook scheduled at `stationId` on `date`, if any and if that cook still exists. */
export function shiftCook(
  state: Pick<AppState, 'stationShifts' | 'cooks'>,
  date: string,
  stationId: string,
): string | undefined {
  const row = (state.stationShifts ?? []).find((s) => s.date === date && s.stationId === stationId);
  if (!row) return undefined;
  return state.cooks.some((c) => c.id === row.cookId) ? row.cookId : undefined;
}

/** The whole day's schedule as stationId → cookId (only cooks that still exist). */
export function shiftsOn(state: Pick<AppState, 'stationShifts' | 'cooks'>, date: string): Map<string, string> {
  const cooks = new Set(state.cooks.map((c) => c.id));
  const out = new Map<string, string>();
  for (const s of state.stationShifts ?? []) if (s.date === date && cooks.has(s.cookId)) out.set(s.stationId, s.cookId);
  return out;
}

/** Sets or clears one (date, station) slot. Absolute, so replay and double taps are harmless. */
export function withShift(
  shifts: StationShift[] | undefined,
  date: string,
  stationId: string,
  cookId: string | null,
): StationShift[] {
  const rest = (shifts ?? []).filter((s) => !(s.date === date && s.stationId === stationId));
  return cookId ? [...rest, { date, stationId, cookId }] : rest;
}
