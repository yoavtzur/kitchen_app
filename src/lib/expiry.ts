import type { AppState, ExpiryChange, Product, Unit, WasteItemType } from '../types';
import { addDays, daysBetween } from './date';

/**
 * Expiry is one date per item: the **last day it is good**. It is not a batch record. For a prepared
 * product the date is the *earliest* of what is on the shelf (see `batchExpiry`): the conservative
 * answer, which can only ever flag something early, never hide something that has turned.
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

/** The shelf life to use from a recipe, or `undefined` when there is none. A stored value that is
 * not a whole number of days (an imported file, a hand-edited snapshot) is treated as unset rather
 * than turned into an `NaN` date. */
export function validShelfLife(days: unknown): number | undefined {
  return typeof days === 'number' && Number.isInteger(days) && days >= 0 && days <= 365 ? days : undefined;
}

/** The last good day of something made on `preparedOn`: the day itself plus its shelf life. */
export function expiryForBatch(preparedOn: string, shelfLifeDays: number): string {
  return addDays(preparedOn, shelfLifeDays);
}

/**
 * What a product's two dates become when a batch good until `batchExpiresOn` is added to the shelf.
 *
 * - Nothing on the shelf (or no date on what is there): the new batch's date is the date.
 * - Something already there: the **earlier** date stays, so the whole stock is flagged as soon as
 *   the oldest part is due. The new batch's own date is remembered in `lastBatchExpiresOn`, for the
 *   moment the old part is thrown and "good until?" has to be asked.
 *
 * Dates are `YYYY-MM-DD`, so comparing them as strings is comparing them as days.
 */
export function batchExpiry(
  product: Pick<Product, 'currentQty' | 'expiresOn' | 'lastBatchExpiresOn'>,
  batchExpiresOn: string,
): ExpiryChange {
  const before = {
    ...(product.expiresOn ? { expiresOn: product.expiresOn } : {}),
    ...(product.lastBatchExpiresOn ? { lastBatchExpiresOn: product.lastBatchExpiresOn } : {}),
  };
  const hasOlder = product.currentQty > 0 && Boolean(product.expiresOn);
  const expiresOn = hasOlder && (product.expiresOn as string) < batchExpiresOn ? (product.expiresOn as string) : batchExpiresOn;
  const lastBatchExpiresOn =
    hasOlder && product.lastBatchExpiresOn && product.lastBatchExpiresOn > batchExpiresOn
      ? product.lastBatchExpiresOn
      : batchExpiresOn;
  return { before, after: { expiresOn, lastBatchExpiresOn } };
}

/** What is left good after the expired part of a product was thrown: the date of the last batch
 * made, when it is still in the future and later than the date that was flagged. */
export function remainingExpiry(
  product: Pick<Product, 'lastBatchExpiresOn'>,
  flaggedOn: string,
  today: string,
): string | undefined {
  const last = product.lastBatchExpiresOn;
  return last && last > flaggedOn && last >= today ? last : undefined;
}

export type SoonItem = { itemType: WasteItemType; id: string; name: string; expiresOn: string; daysLeft: number };

/** Still in stock and due today or tomorrow — the moment to use it, before it becomes waste. Soonest first. */
export function soonItems(state: AppState, today: string): SoonItem[] {
  const out: SoonItem[] = [];
  const consider = (itemType: WasteItemType, item: AppState['ingredients'][number] | AppState['products'][number]) => {
    if (item.currentQty <= 0 || expiryStatus(item.expiresOn, today) !== 'soon') return;
    const expiresOn = item.expiresOn as string;
    out.push({ itemType, id: item.id, name: item.name, expiresOn, daysLeft: daysBetween(today, expiresOn) });
  };
  for (const ing of state.ingredients) consider('ingredient', ing);
  for (const product of state.products) consider('product', product);
  return out.sort((a, b) => a.daysLeft - b.daysLeft || a.name.localeCompare(b.name, 'he'));
}

/** What a cook needs to write on the container after a prep task: the dates of this batch, and a
 * warning when an older batch is still on the shelf (the app keeps the earlier date). */
export type BatchLabel = {
  productName: string;
  preparedOn: string;
  expiresOn: string;
  /** Set when stock that is already on the shelf is good for a shorter time than this batch. */
  olderExpiresOn?: string;
};
