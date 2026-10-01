import { TODAY_STATION_KEY } from './resetLocalData';
import { stationOptions, type CategoryFilter } from './recipeCategories';
import type { Station } from '../types';

/**
 * Remembering which station tab the task list was left on.
 *
 * `Today` unmounts whenever a cook opens another screen, so a plain `useState('all')` put them
 * back on "הכל" every time they returned — and a cook who works one station had to re-pick it on
 * every trip to the stock count and back. The choice is a preference of this device, not kitchen
 * data, so it lives in `localStorage` (not the synced state, which would flip every other
 * cook's tab too) and, being a preference, survives a reload as well.
 */

export function readStoredStation(): CategoryFilter {
  try {
    return localStorage.getItem(TODAY_STATION_KEY) || 'all';
  } catch {
    return 'all'; // storage unavailable (private mode): the tab simply is not remembered
  }
}

export function writeStoredStation(value: CategoryFilter): void {
  try {
    if (value === 'all') localStorage.removeItem(TODAY_STATION_KEY);
    else localStorage.setItem(TODAY_STATION_KEY, value);
  } catch {
    // nothing to do: not being able to remember a tab is not worth a message
  }
}

/**
 * The tab to actually show. A remembered station that has since been deleted (or renamed away on
 * another device) would otherwise filter the list to nothing under a tab that no longer exists,
 * so it falls back to "הכל". The stored value is left alone: if the station comes back, so does
 * the tab.
 */
export function resolveStation(stored: CategoryFilter, stations: Station[] | undefined | null): CategoryFilter {
  if (stored === 'all') return 'all';
  return stationOptions(stations).some((o) => o.value === stored) ? stored : 'all';
}
