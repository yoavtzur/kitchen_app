import { describe, expect, it } from 'vitest';
import { NEW_INGREDIENT_REF, scannedToDraft } from '../recipeDraft';
import type { ScannedRecipe } from '../geminiScanner';
import type { Ingredient, Product } from '../../types';

const ingredients: Ingredient[] = [
  { id: 'ing-flour', name: 'קמח', unit: 'kg', currentQty: 10, dailyUsage: 1, weeklyUsage: 7 },
  { id: 'ing-tomato', name: 'עגבניות', unit: 'kg', currentQty: 5, dailyUsage: 1, weeklyUsage: 7 },
  { id: 'ing-oil', name: 'שמן זית', unit: 'l', currentQty: 3, dailyUsage: 0.2, weeklyUsage: 1.4 },
];

const products: Product[] = [
  { id: 'prod-dough', name: 'בצק לפיצות', kind: 'component', unit: 'unit', currentQty: 4, weeklyTarget: 20, dailyUsage: 3 },
];

function scan(partial: Partial<ScannedRecipe>): ScannedRecipe {
  return {
    name: 'מתכון',
    yieldQty: null,
    yieldUnit: null,
    servings: null,
    prepTimeMinutes: null,
    cookTimeMinutes: null,
    ingredients: [],
    steps: [],
    ...partial,
  };
}

describe('scannedToDraft', () => {
  it('resolves an exact ingredient name to its id', () => {
    const draft = scannedToDraft(
      scan({ ingredients: [{ name: 'קמח', qty: 2, unit: 'kg', raw: '2 ק"ג קמח' }] }),
      { ingredients, products },
    );

    expect(draft.items[0]).toMatchObject({ refType: 'ingredient', refId: 'ing-flour', qty: 2, unit: 'kg' });
    expect(draft.newIngredientNames).toEqual([]);
  });

  it('matches on containment in either direction', () => {
    const draft = scannedToDraft(
      scan({
        ingredients: [
          { name: 'עגבניות שרי', qty: 1, unit: 'kg', raw: '1 ק"ג עגבניות שרי' },
          { name: 'שמן', qty: 0.1, unit: 'l', raw: '100 מ"ל שמן' },
        ],
      }),
      { ingredients, products },
    );

    expect(draft.items[0].refId).toBe('ing-tomato');
    expect(draft.items[1].refId).toBe('ing-oil');
  });

  it('falls back to products when no ingredient matches', () => {
    const draft = scannedToDraft(
      scan({ ingredients: [{ name: 'בצק לפיצות', qty: 3, unit: null, raw: '3 בצקים' }] }),
      { ingredients, products },
    );

    expect(draft.items[0]).toMatchObject({ refType: 'product', refId: 'prod-dough', unit: 'unit' });
  });

  it('marks an unknown name as a new ingredient rather than inventing an id', () => {
    const draft = scannedToDraft(
      scan({ ingredients: [{ name: 'זעתר', qty: 50, unit: 'g', raw: '50 גרם זעתר' }] }),
      { ingredients, products },
    );

    expect(draft.items[0]).toMatchObject({
      refType: 'ingredient',
      refId: NEW_INGREDIENT_REF,
      newIngredientName: 'זעתר',
      qty: 50,
      unit: 'g',
    });
    expect(draft.newIngredientNames).toEqual(['זעתר']);
  });

  it("uses the matched item's own stock unit when the page states no usable unit", () => {
    // "2 כוסות קמח" — normalizeUnit already returned null for כוס upstream.
    const draft = scannedToDraft(
      scan({ ingredients: [{ name: 'קמח', qty: 2, unit: null, raw: '2 כוסות קמח' }] }),
      { ingredients, products },
    );

    expect(draft.items[0].unit).toBe('kg');
  });

  it('keeps the source line so the cook can check the AI against the photo', () => {
    const draft = scannedToDraft(
      scan({ ingredients: [{ name: 'קמח', qty: 1, unit: 'kg', raw: '1 ק"ג קמח מלא' }] }),
      { ingredients, products },
    );

    expect(draft.items[0].sourceLine).toBe('1 ק"ג קמח מלא');
  });

  it('defaults a missing quantity to 0 so the row is visible but unsaved', () => {
    // RecipeEditor.save() skips items with qty <= 0, so the cook must fill this in on purpose.
    const draft = scannedToDraft(
      scan({ ingredients: [{ name: 'מלח', qty: null, unit: null, raw: 'מלח לפי הטעם' }] }),
      { ingredients, products },
    );

    expect(draft.items[0].qty).toBe(0);
  });

  it('prefers a stated yield, then servings, then one batch', () => {
    const stated = scannedToDraft(scan({ yieldQty: 2, yieldUnit: 'kg' }), { ingredients, products });
    expect(stated).toMatchObject({ yieldQty: 2, yieldUnit: 'kg' });

    const fromServings = scannedToDraft(scan({ servings: 4 }), { ingredients, products });
    expect(fromServings).toMatchObject({ yieldQty: 4, yieldUnit: 'unit' });

    const neither = scannedToDraft(scan({}), { ingredients, products });
    expect(neither).toMatchObject({ yieldQty: 1, yieldUnit: 'unit' });
  });

  it('carries name and steps through unchanged', () => {
    const draft = scannedToDraft(
      scan({ name: 'פוקצ׳ה', steps: ['ללוש', 'לאפות'] }),
      { ingredients, products },
    );

    expect(draft.name).toBe('פוקצ׳ה');
    expect(draft.steps).toEqual(['ללוש', 'לאפות']);
  });
});
