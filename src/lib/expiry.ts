import type { AppState, Unit, WasteItemType } from '../types';
import { addDays, daysBetween } from './date';

/**
 * Expiry is one date per item: the **last day it is good**. It is not a batch record — a second
 * delivery of the same thing is the chef's call (extend the date, or throw the old one first).
 *
 * Everything here is a pure function of plain data and a `today` passed in, like `calc.ts`.
 */
export type ExpiryStatus = 'expired' | 'soon' | 'ok' | 'none';

/** "Soon" is today and tomorrow. One constant, so changing the lead time is one edit. */
export const SOON_DAYS = 1;

export function expiryStatus(expiresOn: string | undefined, today: string): ExpiryStatus {
  if (!expiresOn) return 'none';
  const left = daysBetween(today, expiresOn);
  if (left < 0) return 'expired';
  if (left <= SOON_DAYS) return 'soon';
  return 'ok';
}

export type ExpiredItem = {
  itemType: WasteItemType;
  id: string;
  name: string;
  unit: Unit;
  qty: number;
  expiresOn: string;
  /** How many days past its date it is; always at least 1. */
  daysOver: number;
};

/**
 * What needs a decision today: every ingredient and prepared product past its date that still has
 * stock. Something already used up has nothing left to throw, so it stays quiet rather than nag.
 * Most overdue first.
 */
export function expiredItems(state: AppState, today: string): ExpiredItem[] {
  const out: ExpiredItem[] = [];
  const consider = (itemType: WasteItemType, item: AppState['ingredients'][number] | AppState['products'][number]) => {
    if (item.currentQty <= 0 || expiryStatus(item.expiresOn, today) !== 'expired') return;
    const expiresOn = item.expiresOn as string;
    out.push({
      itemType,
      id: item.id,
      name: item.name,
      unit: item.unit,
      qty: item.currentQty,
      expiresOn,
      daysOver: daysBetween(expiresOn, today),
    });
  };
  for (const ing of state.ingredients) consider('ingredient', ing);
  for (const product of state.products) consider('product', product);
  return out.sort((a, b) => b.daysOver - a.daysOver || a.name.localeCompare(b.name, 'he'));
}

/** The new last-good day when a cook extends: counted from today, never from the old date, so
 * "עוד 3 ימים" always means three days from now even for something a week overdue. */
export function extendedExpiry(today: string, days: number): string {
  return addDays(today, days);
}
