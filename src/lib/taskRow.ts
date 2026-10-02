import type { Station } from '../types';

/**
 * The small decisions the task screen makes about what to show, kept out of the components so
 * they can be tested without a browser.
 */

/** Station tabs only exist to narrow a list down, so with no station of the kitchen's own there is
 * nothing to narrow to: "הכל" and the permanent "כללי" bucket would be the same list twice. */
export function showStationTabs(stations: readonly Station[] | undefined | null): boolean {
  return (stations ?? []).length > 0;
}

/** A heading above a group names where its tasks belong. With the tabs hidden and a single group
 * it would only repeat "כללי" over the one list there is. With tabs showing, "הכל" is the survey
 * view and its headings are the point, even when only one station has work left. */
export function showStationHeadings(groupCount: number, tabsShown: boolean): boolean {
  return tabsShown || groupCount > 1;
}

/** What goes in the assignee circle: the first letter of the name. */
export function assigneeInitial(name: string): string {
  return Array.from(name.trim())[0] ?? '?';
}

/** The "completed per cook" readout is a shift summary. Before anyone has finished anything it is
 * a card of zeros, so it waits for the first completion. */
export function showCookCompletions(counts: readonly { count: number }[]): boolean {
  return counts.some((c) => c.count > 0);
}
