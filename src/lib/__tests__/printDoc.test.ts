import { describe, expect, it } from 'vitest';
import { createSeedState } from '../../data/seed';
import {
  ALL,
  buildOrderDoc,
  buildStockDoc,
  buildTaskDoc,
  docToText,
  orderSuppliers,
  stockGroups,
} from '../printDoc';
import type { AppState } from '../../types';

const date = '2026-10-03';

function state(): AppState {
  const s = createSeedState();
  return {
    ...s,
    stations: [{ id: 'st-hot', name: 'חם', createdAt: '2026-01-01' }],
    recipes: s.recipes.map((r, i) => (i === 0 ? { ...r, category: 'st-hot' } : r)),
    tasks: [
      { id: 't1', date, title: 'ניקוי מדפים', multiplier: 1, priority: 'yellow', done: false, source: 'manual', assigneeId: 'cook-1' },
      { id: 't2', date, title: 'פח', multiplier: 1, priority: 'green', done: true, source: 'manual' },
    ],
  };
}

describe('buildTaskDoc', () => {
  it('groups by station, leaves done tasks out unless asked', () => {
    const doc = buildTaskDoc(state(), date, { stations: [], cookId: ALL, includeDone: false, pageBreaks: false }, 'מטבח');
    expect(doc.title).toBe('מטבח — רשימת הכנות');
    expect(doc.checkboxes).toBe(true);
    const all = doc.sections.flatMap((s) => s.rows.map((r) => r[0]));
    expect(all).toContain('ניקוי מדפים');
    expect(all).not.toContain('✓ פח');
    const withDone = buildTaskDoc(state(), date, { stations: [], cookId: ALL, includeDone: true, pageBreaks: false });
    expect(withDone.sections.flatMap((s) => s.rows.map((r) => r[0]))).toContain('✓ פח');
  });

  it('filters by cook and by station', () => {
    const byCook = buildTaskDoc(state(), date, { stations: [], cookId: 'cook-1', includeDone: true, pageBreaks: false });
    expect(byCook.sections.flatMap((s) => s.rows)).toEqual([['ניקוי מדפים', '', 'דני']]);
    expect(byCook.subtitle).toContain('דני');
    const unassigned = buildTaskDoc(state(), date, { stations: [], cookId: 'none', includeDone: true, pageBreaks: false });
    expect(unassigned.sections.flatMap((s) => s.rows.map((r) => r[0]))).not.toContain('ניקוי מדפים');
    const none = buildTaskDoc(state(), date, { stations: ['st-hot'], cookId: 'cook-1', includeDone: true, pageBreaks: false });
    expect(none.sections).toEqual([]);
  });
});

describe('buildStockDoc', () => {
  it('ingredients by supplier, narrowed to one, with a blank count column', () => {
    const s = state();
    const groups = stockGroups(s, 'ingredients', 'supplier');
    expect(groups.length).toBeGreaterThan(1);
    const doc = buildStockDoc(s, date, { kind: 'ingredients', groupBy: 'supplier', group: groups[0], blankCount: true, pageBreaks: true });
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0].heading).toBe(groups[0]);
    expect(doc.sections[0].columns.at(-1)).toBe('ספירה');
    expect(doc.sections[0].rows.every((r) => r.at(-1) === '')).toBe(true);
  });

  it('products by station', () => {
    const doc = buildStockDoc(state(), date, { kind: 'products', groupBy: 'station', group: ALL, blankCount: false, pageBreaks: false });
    expect(doc.sections.map((x) => x.heading)).toContain('חם');
    expect(doc.sections.flatMap((x) => x.rows)).toHaveLength(state().products.length);
  });
});

describe('buildOrderDoc', () => {
  it('lists today\'s order by supplier and can be narrowed to one', () => {
    const s = state();
    const suppliers = orderSuppliers(s, date);
    const doc = buildOrderDoc(s, date, { supplier: ALL, pageBreaks: false }, undefined, (n) => (n === suppliers[0] ? '050-1' : undefined));
    expect(doc.sections.map((x) => x.heading)).toEqual(suppliers);
    expect(doc.sections[0].note).toBe('050-1');
    const one = buildOrderDoc(s, date, { supplier: suppliers[0], pageBreaks: false });
    expect(one.sections).toHaveLength(1);
  });
});

describe('docToText', () => {
  it('reads as a message, with labels and units in place', () => {
    const text = docToText({
      title: 'מלאי',
      subtitle: '3/10/2026',
      checkboxes: false,
      pageBreaks: false,
      sections: [
        { heading: 'ירקות', columns: ['פריט', 'יחידה', 'במלאי', 'מינימום', 'ספירה'], rows: [['עגבניות', 'ק"ג', '4', '12', '']] },
        { heading: 'ספק', note: '050', columns: ['פריט', 'כמות', 'יחידה'], rows: [['ביצים', '30', "יח'"]] },
      ],
    });
    expect(text).toBe(
      ['*מלאי*', '3/10/2026', '', '*ירקות*', '• עגבניות — במלאי 4 · מינימום 12 ק"ג', '', '*ספק*', '050', "• ביצים — 30 יח'"].join('\n'),
    );
  });

  it('says so when empty', () => {
    expect(docToText({ title: 'x', subtitle: 'y', checkboxes: true, pageBreaks: false, sections: [] })).toContain('אין פריטים');
  });
});
