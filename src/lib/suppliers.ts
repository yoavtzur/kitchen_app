import { dayOfWeek, dayShortLabel } from './date';
import { NO_SUPPLIER } from './receiving';
import { whatsappHref } from './phone';
import type { AppState, Supplier } from '../types';

/**
 * Supplier cards (`AppState.suppliers`) and the plain supplier names ingredients carry, as one list.
 * A card is linked to its ingredients by name, so a name typed on an ingredient before any card
 * existed is still a supplier here — just one with no phone yet.
 */

/** Every supplier name in use, cards and ingredients alike, alphabetically. */
export function supplierNames(state: Pick<AppState, 'ingredients' | 'suppliers'>): string[] {
  const names = new Set<string>();
  for (const s of state.suppliers ?? []) if (s.name.trim()) names.add(s.name.trim());
  for (const i of state.ingredients) if (i.supplier?.trim()) names.add(i.supplier.trim());
  return [...names].sort((a, b) => a.localeCompare(b, 'he'));
}

export function supplierByName(state: Pick<AppState, 'suppliers'>, name: string): Supplier | undefined {
  const n = name.trim();
  return (state.suppliers ?? []).find((s) => s.name.trim() === n);
}

/** How many ingredients come from this supplier. */
export function ingredientCount(state: Pick<AppState, 'ingredients'>, name: string): number {
  return state.ingredients.filter((i) => i.supplier?.trim() === name.trim()).length;
}

/** Whether an order goes to this supplier on `date`. `null` when the card sets no order days. */
export function ordersOn(supplier: Supplier | undefined, date: string): boolean | null {
  if (!supplier?.orderDays || supplier.orderDays.length === 0) return null;
  return supplier.orderDays.includes(dayOfWeek(date));
}

/** "א׳ ג׳ ה׳" */
export function orderDaysLabel(supplier: Supplier | undefined): string {
  if (!supplier?.orderDays || supplier.orderDays.length === 0) return '';
  return supplier.orderDays.map((d) => dayShortLabel(d)).join(' ');
}

/**
 * Supplier names reordered so the ones ordered from today come first, keeping the given order
 * otherwise (the sort is stable). "ללא ספק" stays last.
 */
export function todayFirst(names: string[], state: Pick<AppState, 'suppliers'>, date: string): string[] {
  const rank = (n: string) => (n === NO_SUPPLIER ? 2 : ordersOn(supplierByName(state, n), date) ? 0 : 1);
  return [...names].sort((a, b) => rank(a) - rank(b));
}

/** The line under a supplier's name on a printed order: who to call and on what number. */
export function supplierNote(supplier: Supplier | undefined): string | undefined {
  if (!supplier) return undefined;
  const parts = [supplier.contactName?.trim(), supplier.phone?.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/** wa.me to the supplier's own number when the card has one, else WhatsApp's contact picker. */
export function whatsappSendHref(phone: string | undefined, text: string): string {
  const q = `?text=${encodeURIComponent(text)}`;
  return phone?.trim() ? `${whatsappHref(phone)}${q}` : `https://wa.me/${q}`;
}

/** A name problem, in Hebrew, or null. */
export function supplierNameError(name: string, suppliers: Supplier[] | undefined, exceptId?: string): string | null {
  const n = name.trim();
  if (!n) return 'נא למלא שם ספק';
  if (n === NO_SUPPLIER) return 'השם הזה שמור';
  if ((suppliers ?? []).some((s) => s.id !== exceptId && s.name.trim() === n)) return 'כבר יש ספק בשם הזה';
  return null;
}
