import { describe, expect, it } from 'vitest';
import {
  ingredientCount,
  orderDaysLabel,
  ordersOn,
  supplierByName,
  supplierNameError,
  supplierNames,
  supplierNote,
  todayFirst,
  whatsappSendHref,
} from '../suppliers';
import { reducer } from '../../store/reducer';
import { createSeedState } from '../../data/seed';
import type { Supplier } from '../../types';

const card: Supplier = { id: 's1', name: 'ירקן', phone: '050-1234567', contactName: 'משה', orderDays: [0, 3] };
// 2026-10-04 is a Sunday (0), 2026-10-05 a Monday (1).
const sunday = '2026-10-04';
const monday = '2026-10-05';

describe('suppliers', () => {
  it('lists card names and ingredient names once, alphabetically', () => {
    const s = { suppliers: [card, { id: 's2', name: 'אטליז' }], ingredients: [{ supplier: 'ירקן ' }, { supplier: 'דגים' }, {}] };
    expect(supplierNames(s as never)).toEqual(['אטליז', 'דגים', 'ירקן']);
    expect(supplierByName(s as never, ' ירקן')).toBe(card);
    expect(ingredientCount(s as never, 'ירקן')).toBe(1);
  });

  it('order days', () => {
    expect(ordersOn(card, sunday)).toBe(true);
    expect(ordersOn(card, monday)).toBe(false);
    expect(ordersOn({ id: 'x', name: 'x' }, sunday)).toBeNull();
    expect(orderDaysLabel(card)).toBe('א׳ ד׳');
    expect(todayFirst(['אטליז', 'ללא ספק', 'ירקן'], { suppliers: [card] }, sunday)).toEqual(['ירקן', 'אטליז', 'ללא ספק']);
  });

  it('notes and links', () => {
    expect(supplierNote(card)).toBe('משה · 050-1234567');
    expect(supplierNote({ id: 'x', name: 'x' })).toBeUndefined();
    expect(whatsappSendHref('050-1234567', 'a b')).toBe('https://wa.me/972501234567?text=a%20b');
    expect(whatsappSendHref(undefined, 'a')).toBe('https://wa.me/?text=a');
  });

  it('name validation', () => {
    expect(supplierNameError(' ', [])).not.toBeNull();
    expect(supplierNameError('ירקן', [card])).not.toBeNull();
    expect(supplierNameError('ירקן', [card], 's1')).toBeNull();
    expect(supplierNameError('ללא ספק', [])).not.toBeNull();
  });
});

describe('SAVE_SUPPLIER / DELETE_SUPPLIER', () => {
  it('adds, renames (re-pointing ingredients), refuses duplicates, deletes the card only', () => {
    let s = createSeedState();
    const name = s.ingredients[0].supplier!;
    s = reducer(s, { type: 'SAVE_SUPPLIER', supplier: { id: 'sx', name, phone: '1' } });
    expect(s.suppliers).toHaveLength(1);
    s = reducer(s, { type: 'SAVE_SUPPLIER', supplier: { id: 'sx', name: 'שם חדש', phone: '1' } });
    expect(s.ingredients[0].supplier).toBe('שם חדש');
    expect(s.ingredients.some((i) => i.supplier === name)).toBe(false);
    const dup = reducer(s, { type: 'SAVE_SUPPLIER', supplier: { id: 'sy', name: 'שם חדש' } });
    expect(dup).toBe(s);
    s = reducer(s, { type: 'DELETE_SUPPLIER', id: 'sx' });
    expect(s.suppliers).toEqual([]);
    expect(s.ingredients[0].supplier).toBe('שם חדש');
    expect(reducer(s, { type: 'DELETE_SUPPLIER', id: 'sx' })).toBe(s);
  });
});
