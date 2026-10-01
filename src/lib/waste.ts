import type { AppState, Unit, WasteEntry, WasteItemType, WasteReason } from '../types';
import { addDays, toDateStr, weekDates } from './date';
import { newId } from './ids';

/**
 * Builds the log row for something thrown away. The id and timestamp are made here, once, in the
 * UI — never inside the reducer — so replaying the same op on another device or after a retry
 * produces the identical row (and `LOG_WASTE` ignores an id it already has).
 */
export function newWasteEntry(input: {
  today: string;
  itemType: WasteItemType;
  itemId: string;
  itemName: string;
  unit: Unit;
  qty: number;
  reason: WasteReason;
  expiredOn?: string;
  cookId?: string;
}): WasteEntry {
  const { today, expiredOn, cookId, ...rest } = input;
  return {
    id: newId('waste'),
    date: today,
    at: new Date().toISOString(),
    ...rest,
    // Absent rather than `undefined`: JSON drops an undefined key, so a replayed op would
    // otherwise differ from the row the device that made it is holding.
    ...(expiredOn ? { expiredOn } : {}),
    ...(cookId ? { cookId } : {}),
  };
}

export type WastePeriod = 'week' | 'month';

export type DateRange = { from: string; to: string };

/** The week (per the kitchen's own first weekday) or calendar month containing `anchor`. */
export function periodRange(period: WastePeriod, anchor: string, weekStartsOn: 0 | 1): DateRange {
  if (period === 'week') {
    const days = weekDates(anchor, weekStartsOn);
    return { from: days[0], to: days[6] };
  }
  const [y, m] = anchor.split('-').map(Number);
  return { from: toDateStr(new Date(y, m - 1, 1)), to: toDateStr(new Date(y, m, 0)) };
}

/** `anchor` moved one period earlier (`-1`) or later (`+1`). */
export function shiftPeriod(period: WastePeriod, anchor: string, direction: -1 | 1): string {
  if (period === 'week') return addDays(anchor, 7 * direction);
  const [y, m] = anchor.split('-').map(Number);
  return toDateStr(new Date(y, m - 1 + direction, 1));
}

export type WasteSummaryRow = {
  itemType: WasteItemType;
  itemId: string;
  name: string;
  unit: Unit;
  totalQty: number;
  count: number;
};

/**
 * Total thrown per item over a date range, most first.
 *
 * Grouped by id, not by name, so two things with the same name stay separate — but the *name
 * shown* is the one on the latest entry, so a rename is reflected and a deleted ingredient keeps
 * the name it was thrown under.
 */
export function summarizeWaste(log: WasteEntry[], range: DateRange): WasteSummaryRow[] {
  const rows = new Map<string, WasteSummaryRow>();
  for (const e of log) {
    if (e.date < range.from || e.date > range.to) continue;
    const key = `${e.itemType}:${e.itemId}`;
    const row = rows.get(key);
    if (row) {
      row.totalQty += e.qty;
      row.count += 1;
      row.name = e.itemName;
    } else {
      rows.set(key, {
        itemType: e.itemType,
        itemId: e.itemId,
        name: e.itemName,
        unit: e.unit,
        totalQty: e.qty,
        count: 1,
      });
    }
  }
  return [...rows.values()]
    .map((r) => ({ ...r, totalQty: Math.round(r.totalQty * 100) / 100 }))
    .sort((a, b) => b.totalQty - a.totalQty || a.name.localeCompare(b.name, 'he'));
}

/** Newest first (by timestamp, which is what the log's own order cannot promise once two devices
 * both append offline). */
export function sortedWasteLog(state: Pick<AppState, 'wasteLog'>): WasteEntry[] {
  return [...(state.wasteLog ?? [])].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
