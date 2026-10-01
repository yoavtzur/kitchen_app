import { addDays } from './date';
import type { AppState, Ingredient } from '../types';

/** How far back an order can still be waiting for its delivery. A week covers a supplier that
 * ships twice weekly; older than that is a forgotten line, not a late truck. */
export const RECEIVING_WINDOW_DAYS = 7;

export const NO_SUPPLIER = 'ללא ספק';

export type ReceivableLine = {
  ingredient: Ingredient;
  date: string;
  /** What was ordered. */
  ordered: number;
  /** What has arrived so far. */
  received: number;
  /** What is still owed — never negative (a delivery of more than was asked for is just done). */
  remaining: number;
};

export type SupplierGroup = { supplier: string; lines: ReceivableLine[] };

/**
 * The order lines that went out and are within the receiving window, newest order first within a
 * supplier — everything the receiving screen can show, finished or not.
 */
export function orderedLines(state: AppState, today: string): ReceivableLine[] {
  const oldest = addDays(today, -(RECEIVING_WINDOW_DAYS - 1));
  const out: ReceivableLine[] = [];
  for (const line of state.orderLines) {
    if (!line.ordered || line.date < oldest || line.date > today) continue;
    const ordered = line.qtyOverride ?? 0;
    if (ordered <= 0) continue;
    const ingredient = state.ingredients.find((i) => i.id === line.ingredientId);
    if (!ingredient) continue;
    const received = line.receivedQty ?? 0;
    out.push({ ingredient, date: line.date, ordered, received, remaining: Math.max(0, ordered - received) });
  }
  return out;
}

/** Groups by the ingredient's supplier — suppliers alphabetically, "no supplier" last, and within
 * one supplier the newest order first and then by ingredient name, so the list is the same on
 * every device. */
export function bySupplier(lines: readonly ReceivableLine[]): SupplierGroup[] {
  const map = new Map<string, ReceivableLine[]>();
  for (const line of lines) {
    const supplier = line.ingredient.supplier?.trim() || NO_SUPPLIER;
    map.set(supplier, [...(map.get(supplier) ?? []), line]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === NO_SUPPLIER ? 1 : b === NO_SUPPLIER ? -1 : a.localeCompare(b, 'he')))
    .map(([supplier, group]) => ({
      supplier,
      lines: [...group].sort(
        (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.ingredient.name.localeCompare(b.ingredient.name, 'he')),
      ),
    }));
}

export const stillOwed = (lines: readonly ReceivableLine[]) => lines.filter((l) => l.remaining > 0);
export const fullyReceived = (lines: readonly ReceivableLine[]) => lines.filter((l) => l.remaining === 0);
