import type { Station } from '../types';

/** The built-in "no station assigned" bucket — never a real `Station` row, always available even
 * in a kitchen with zero stations of its own. */
export const UNASSIGNED_CATEGORY = 'general';
export const UNASSIGNED_LABEL = 'כללי';

export type CategoryFilter = string;

/** A kitchen's real stations plus the permanent `UNASSIGNED_CATEGORY` fallback — never empty,
 * even before a chef has created any station. */
export function stationOptions(stations: Station[]): { value: string; label: string }[] {
  return [
    ...stations.map((s) => ({ value: s.id, label: s.name })),
    { value: UNASSIGNED_CATEGORY, label: UNASSIGNED_LABEL },
  ];
}

// "הכל" leads the row so browsing everything at once is the default, not a tab you have to
// find — the individual stations stay right beside it for narrowing down.
export function categoryTabs(stations: Station[]): { value: CategoryFilter; label: string }[] {
  return [{ value: 'all', label: 'הכל' }, ...stationOptions(stations)];
}
