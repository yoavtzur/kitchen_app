import { describe, expect, it } from 'vitest';
import { normalizeUnit, sanitizeScanned } from '../geminiScanner';

describe('normalizeUnit', () => {
  it('maps Hebrew and English spellings onto the app units', () => {
    expect(normalizeUnit('גרם')).toBe('g');
    expect(normalizeUnit('ק"ג')).toBe('kg');
    expect(normalizeUnit('קילו')).toBe('kg');
    expect(normalizeUnit('ליטר')).toBe('l');
    expect(normalizeUnit('מ"ל')).toBe('ml');
    expect(normalizeUnit("יח'")).toBe('unit');
    expect(normalizeUnit('Grams')).toBe('g');
    expect(normalizeUnit(' ML ')).toBe('ml');
  });

  it('returns null for units the app cannot represent, rather than guessing', () => {
    // No density model — "2 cups of flour" must not silently become grams.
    expect(normalizeUnit('כוס')).toBeNull();
    expect(normalizeUnit('כפית')).toBeNull();
    expect(normalizeUnit('קורט')).toBeNull();
    expect(normalizeUnit('')).toBeNull();
    expect(normalizeUnit(null)).toBeNull();
    expect(normalizeUnit(42)).toBeNull();
  });
});

describe('sanitizeScanned', () => {
  it('keeps a well-formed response intact', () => {
    const scanned = sanitizeScanned({
      name: 'בצק לפיצה',
      yieldQty: 2,
      yieldUnit: 'kg',
      servings: null,
      prepTimeMinutes: 20,
      cookTimeMinutes: null,
      ingredients: [{ name: 'קמח', qty: 1, unit: 'ק"ג', raw: '1 ק"ג קמח' }],
      steps: ['ללוש', 'לתפח'],
    });

    expect(scanned.name).toBe('בצק לפיצה');
    expect(scanned.yieldQty).toBe(2);
    expect(scanned.yieldUnit).toBe('kg');
    expect(scanned.prepTimeMinutes).toBe(20);
    expect(scanned.ingredients).toEqual([{ name: 'קמח', qty: 1, unit: 'kg', unitText: 'ק"ג', raw: '1 ק"ג קמח' }]);
    expect(scanned.steps).toEqual(['ללוש', 'לתפח']);
  });

  it('drops malformed ingredient rows instead of throwing', () => {
    const scanned = sanitizeScanned({
      name: '  סלט  ',
      ingredients: [
        { name: 'עגבניות', qty: '2.5', unit: 'ק"ג', raw: '2.5 ק"ג עגבניות' },
        { name: '', qty: 1 },
        null,
        'not an object',
        { qty: 3 },
      ],
      steps: ['לחתוך', '  ', 42, ''],
    });

    expect(scanned.name).toBe('סלט');
    expect(scanned.ingredients).toHaveLength(1);
    expect(scanned.ingredients[0]).toEqual({ name: 'עגבניות', qty: 2.5, unit: 'kg', unitText: 'ק"ג', raw: '2.5 ק"ג עגבניות' });
    expect(scanned.steps).toEqual(['לחתוך']);
  });

  it('nulls out quantities that are missing, negative or not numbers', () => {
    const scanned = sanitizeScanned({
      name: 'x',
      yieldQty: -3,
      servings: 'nope',
      ingredients: [{ name: 'מלח', qty: null, unit: null, raw: 'מלח לפי הטעם' }],
    });

    expect(scanned.yieldQty).toBeNull();
    expect(scanned.servings).toBeNull();
    expect(scanned.ingredients[0].qty).toBeNull();
    expect(scanned.ingredients[0].unit).toBeNull();
  });

  it('records a written unit even when it cannot be normalized, so callers can tell the two nulls apart', () => {
    const scanned = sanitizeScanned({
      name: 'x',
      ingredients: [
        { name: 'מלח', qty: 0.5, unit: 'כפית', raw: 'חצי כפית מלח' },
        { name: 'ביצים', qty: 2, unit: null, raw: '2 ביצים' },
      ],
    });

    expect(scanned.ingredients[0]).toMatchObject({ unit: null, unitText: 'כפית' });
    expect(scanned.ingredients[1]).toMatchObject({ unit: null, unitText: null });
  });

  it('falls back to the ingredient name when the model omits the raw line', () => {
    const scanned = sanitizeScanned({ name: 'x', ingredients: [{ name: 'שמן זית' }] });
    expect(scanned.ingredients[0].raw).toBe('שמן זית');
  });

  it('survives garbage input entirely', () => {
    for (const input of [null, undefined, 'text', 7, []]) {
      const scanned = sanitizeScanned(input);
      expect(scanned.name).toBe('');
      expect(scanned.ingredients).toEqual([]);
      expect(scanned.steps).toEqual([]);
    }
  });
});
