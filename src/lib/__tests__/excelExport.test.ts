import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { createSeedState } from '../../data/seed';
import { buildExportSheets, exportFileName } from '../excelExport';
import { columnName, safeSheetNames, toXlsx } from '../xlsx';

describe('buildExportSheets', () => {
  it('one sheet per subject, Hebrew headers, names not ids', () => {
    const state = { ...createSeedState(), suppliers: [{ id: 's', name: 'ירקן', phone: '050', orderDays: [0 as const] }] };
    const sheets = buildExportSheets(state);
    expect(sheets.map((s) => s.name)).toEqual(['מצרכים', 'מוצרים', 'מתכונים', 'רכיבי מתכונים', 'הזמנות', 'יומן זריקות', 'ספקים']);
    const ing = sheets[0];
    expect(ing.rows[0][0]).toBe('שם');
    expect(ing.rows).toHaveLength(state.ingredients.length + 1);
    const recipes = sheets[2];
    const firstRecipe = state.recipes.slice().sort((a, b) => a.name.localeCompare(b.name, 'he'))[0];
    const row = recipes.rows.find((r) => r[0] === firstRecipe.name)!;
    expect(String(row[5])).not.toMatch(/ing-|prod-/);
    expect(sheets[3].rows.length - 1).toBe(state.recipes.reduce((n, r) => n + r.items.length, 0));
    expect(sheets[6].rows[1]).toEqual(['ירקן', undefined, '050', undefined, 'א׳']);
  });

  it('file name', () => {
    expect(exportFileName('2026-10-03')).toBe('kitchen-2026-10-03.xlsx');
  });
});

describe('toXlsx', () => {
  it('writes a zip Excel can open: parts, RTL, escaped text, numbers as numbers', () => {
    const bytes = toXlsx([
      { name: 'גיליון', rows: [['שם', 'כמות'], ['א & <ב>', 3.5], ['שורה\nשנייה', null]] },
      { name: 'גיליון', rows: [['x']] },
    ]);
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual(
      [
        '[Content_Types].xml',
        '_rels/.rels',
        'xl/_rels/workbook.xml.rels',
        'xl/styles.xml',
        'xl/workbook.xml',
        'xl/worksheets/sheet1.xml',
        'xl/worksheets/sheet2.xml',
      ].sort(),
    );
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
    expect(sheet).toContain('rightToLeft="1"');
    expect(sheet).toContain('א &amp; &lt;ב&gt;');
    expect(sheet).toContain('<c r="B2"><v>3.5</v></c>');
    expect(sheet).toContain('<c r="A1" t="inlineStr" s="1">');
    expect(sheet).toContain('<c r="A3" t="inlineStr" s="2">');
    expect(strFromU8(files['xl/workbook.xml'])).toContain('name="גיליון 2"');
  });

  it('column names and sheet names', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
    expect(safeSheetNames(['a/b', 'x'.repeat(40), ''])).toEqual(['a b', 'x'.repeat(31), 'Sheet']);
  });
});
