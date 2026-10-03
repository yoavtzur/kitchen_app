import { productStation } from './stations';
import { stationLabel } from './printDoc';
import { categoryOf } from './ingredientCategories';
import { NO_SUPPLIER } from './receiving';
import { orderDaysLabel } from './suppliers';
import { unitLabel } from './units';
import type { AppState } from '../types';
import type { Sheet } from './xlsx';

/**
 * The kitchen as a readable workbook — one sheet per subject, Hebrew headers, names rather than
 * ids. This is for a person to open in Excel; the JSON backup is still what restores the app.
 *
 * Chef only, in the UI: recipes are the restaurant's know-how. (A cook who opens the recipes screen
 * still sees them — that is how they cook — so this hides the bulk download, not the content.)
 */
export function buildExportSheets(state: AppState): Sheet[] {
  const ingName = new Map(state.ingredients.map((i) => [i.id, i.name]));
  const prodName = new Map(state.products.map((p) => [p.id, p.name]));
  const cookName = new Map(state.cooks.map((c) => [c.id, c.name]));
  const he = (a: string, b: string) => a.localeCompare(b, 'he');

  const ingredients: Sheet = {
    name: 'מצרכים',
    rows: [
      ['שם', 'קטגוריה', 'ספק', 'יחידה', 'במלאי', 'מינימום', 'צריכה יומית', 'צריכה שבועית', 'תוקף'],
      ...[...state.ingredients]
        .sort((a, b) => he(a.name, b.name))
        .map((i) => [
          i.name,
          categoryOf(i),
          i.supplier?.trim() || NO_SUPPLIER,
          unitLabel(i.unit),
          i.currentQty,
          i.parLevel,
          i.dailyUsage,
          i.weeklyUsage,
          i.expiresOn,
        ]),
    ],
  };

  const products: Sheet = {
    name: 'מוצרים',
    rows: [
      ['שם', 'סוג', 'עמדה', 'יחידה', 'במלאי', 'מינימום', 'צריכה יומית', 'יעד שבועי', 'תוקף'],
      ...[...state.products]
        .sort((a, b) => he(a.name, b.name))
        .map((p) => [
          p.name,
          p.kind === 'menu' ? 'מנה' : 'רכיב',
          stationLabel(state, productStation(p, state.recipes)),
          unitLabel(p.unit),
          p.currentQty,
          p.parLevel,
          p.dailyUsage,
          p.weeklyTarget,
          p.expiresOn,
        ]),
    ],
  };

  const sortedRecipes = [...state.recipes].sort((a, b) => he(a.name, b.name));
  const recipes: Sheet = {
    name: 'מתכונים',
    rows: [
      ['שם', 'עמדה', 'תפוקה', 'יחידה', 'חיי מדף (ימים)', 'רכיבים', 'אופן הכנה'],
      ...sortedRecipes.map((r) => [
        r.name,
        stationLabel(state, r.category),
        r.yieldQty,
        unitLabel(r.yieldUnit),
        r.shelfLifeDays,
        r.items
          .map((it) => {
            const name = (it.refType === 'ingredient' ? ingName : prodName).get(it.refId) ?? '?';
            return `${name} — ${it.qty} ${unitLabel(it.unit)}`;
          })
          .join('\n'),
        r.steps.map((s, i) => `${i + 1}. ${s}`).join('\n'),
      ]),
    ],
  };

  // The same ingredients one per row, for filtering and sums.
  const recipeItems: Sheet = {
    name: 'רכיבי מתכונים',
    rows: [
      ['מתכון', 'רכיב', 'סוג', 'כמות', 'יחידה'],
      ...sortedRecipes.flatMap((r) =>
        r.items.map((it) => [
          r.name,
          (it.refType === 'ingredient' ? ingName : prodName).get(it.refId) ?? '?',
          it.refType === 'ingredient' ? 'מצרך' : 'מוצר מוכן',
          it.qty,
          unitLabel(it.unit),
        ]),
      ),
    ],
  };

  const orders: Sheet = {
    name: 'הזמנות',
    rows: [
      ['תאריך', 'מצרך', 'ספק', 'כמות', 'יחידה', 'הוזמן', 'התקבל'],
      ...[...state.orderLines]
        .sort((a, b) => (a.date === b.date ? he(ingName.get(a.ingredientId) ?? '', ingName.get(b.ingredientId) ?? '') : a.date < b.date ? 1 : -1))
        .map((l) => {
          const ing = state.ingredients.find((i) => i.id === l.ingredientId);
          return [
            l.date,
            ing?.name ?? '?',
            ing?.supplier?.trim() || NO_SUPPLIER,
            l.qtyOverride,
            ing ? unitLabel(ing.unit) : '',
            l.ordered ? 'כן' : 'לא',
            l.receivedQty,
          ];
        }),
    ],
  };

  const waste: Sheet = {
    name: 'יומן זריקות',
    rows: [
      ['תאריך', 'פריט', 'כמות', 'יחידה', 'סיבה', 'טבח'],
      ...[...(state.wasteLog ?? [])]
        .sort((a, b) => (a.at < b.at ? 1 : -1))
        .map((w) => [
          w.date,
          w.itemName,
          w.qty,
          unitLabel(w.unit),
          w.reason === 'expired' ? 'פג תוקף' : 'התקלקל',
          w.cookId ? (cookName.get(w.cookId) ?? '') : '',
        ]),
    ],
  };

  const suppliers: Sheet = {
    name: 'ספקים',
    rows: [
      ['שם', 'איש קשר', 'טלפון', 'אימייל', 'ימי הזמנה'],
      ...[...(state.suppliers ?? [])]
        .sort((a, b) => he(a.name, b.name))
        .map((s) => [s.name, s.contactName, s.phone, s.email, orderDaysLabel(s)]),
    ],
  };

  return [ingredients, products, recipes, recipeItems, orders, waste, suppliers];
}

/**
 * `kitchen-2026-10-03.xlsx`. Deliberately ASCII: a Hebrew `download` name came out as plain
 * "download" in Chromium (measured).
 */
export function exportFileName(date: string): string {
  return `kitchen-${date}.xlsx`;
}
