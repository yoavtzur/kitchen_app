import { toPrepare } from './calc';
import { getDisplayTasks, groupByStation, type DisplayTask } from './tasks';
import { stationOptions, UNASSIGNED_LABEL } from './recipeCategories';
import { productStation } from './stations';
import { categoryOf, NO_CATEGORY } from './ingredientCategories';
import { buildOrderLines } from './orders';
import { NO_SUPPLIER } from './receiving';
import { formatQty, unitLabel } from './units';
import type { AppState, Ingredient, Product } from '../types';

/**
 * Everything printable, as data: one shape for the task list, the stock and the order, built by
 * pure functions and rendered once (`PrintDocument`) — or turned into text for WhatsApp / copy by
 * `docToText`. Printing used to be "print whatever is on screen", which gave one fixed layout of
 * one screen; here the person picks what goes on the page (a station, a cook, a supplier, a
 * category) and the page is made for paper, not for a phone.
 */
export type PrintSection = {
  heading: string;
  /** Optional line under the heading (a supplier's phone, a station's cook). */
  note?: string;
  columns: string[];
  rows: string[][];
};

export type PrintDoc = {
  title: string;
  subtitle: string;
  /** A tick box at the start of every row (tasks, a count sheet). */
  checkboxes: boolean;
  /** Each section starts a new sheet of paper. */
  pageBreaks: boolean;
  sections: PrintSection[];
};

export const ALL = 'all';

function fmtDate(date: string): string {
  const [y, m, d] = date.split('-');
  return `${Number(d)}/${Number(m)}/${y}`;
}

const num = (n: number) => String(Math.round(n * 100) / 100);

// ── tasks ──────────────────────────────────────────────────────────────────

export type TaskPrintOptions = {
  /** Station ids to include; empty = every station. */
  stations: string[];
  /** A cook's id, `ALL`, or `'none'` for tasks nobody has taken. */
  cookId: string;
  includeDone: boolean;
  pageBreaks: boolean;
};

function taskTitle(task: DisplayTask, state: AppState): string {
  const recipe = state.recipes.find((r) => r.id === task.recipeId);
  return recipe?.name ?? task.title ?? 'משימה';
}

function taskQty(task: DisplayTask, state: AppState): string {
  const product = state.products.find((p) => p.id === task.productId);
  if (product && task.source === 'auto') return formatQty(toPrepare(product, task.date, state), product.unit);
  if (task.recipeId && !task.unitMismatch) return `מתכון ×${task.multiplier}`;
  return '';
}

export function buildTaskDoc(state: AppState, date: string, opts: TaskPrintOptions, restaurantName?: string): PrintDoc {
  const cooks = new Map(state.cooks.map((c) => [c.id, c.name]));
  const tasks = getDisplayTasks(date, state).filter((t) => {
    if (!opts.includeDone && t.done) return false;
    if (opts.stations.length > 0 && !opts.stations.includes(t.category)) return false;
    if (opts.cookId === 'none') return !t.assigneeId;
    if (opts.cookId !== ALL) return t.assigneeId === opts.cookId;
    return true;
  });
  const sections = groupByStation(tasks, state.stations).map((g) => ({
    heading: g.label,
    columns: ['משימה', 'כמות', 'טבח'],
    rows: g.tasks.map((t) => [
      (t.done ? '✓ ' : '') + taskTitle(t, state),
      taskQty(t, state),
      t.assigneeId ? (cooks.get(t.assigneeId) ?? '') : '',
    ]),
  }));
  const who = opts.cookId === ALL ? '' : opts.cookId === 'none' ? ' · לא משויכות' : ` · ${cooks.get(opts.cookId) ?? ''}`;
  return {
    title: `${restaurantName ? `${restaurantName} — ` : ''}רשימת הכנות`,
    subtitle: `${fmtDate(date)}${who}`,
    checkboxes: true,
    pageBreaks: opts.pageBreaks,
    sections,
  };
}

// ── stock ──────────────────────────────────────────────────────────────────

export type StockPrintOptions = {
  kind: 'ingredients' | 'products';
  /** Ingredients: by category or supplier. Products: always by station. */
  groupBy: 'category' | 'supplier' | 'station';
  /** One group to print, or `ALL`. */
  group: string;
  /** An empty column to write the count in by hand: the printout is a count sheet. */
  blankCount: boolean;
  pageBreaks: boolean;
};

export function ingredientGroupKey(ing: Ingredient, groupBy: StockPrintOptions['groupBy']): string {
  return groupBy === 'supplier' ? ing.supplier?.trim() || NO_SUPPLIER : categoryOf(ing);
}

/** The groups a stock printout can be narrowed to, in display order. */
export function stockGroups(state: AppState, kind: StockPrintOptions['kind'], groupBy: StockPrintOptions['groupBy']): string[] {
  if (kind === 'products') {
    const used = new Set(state.products.map((p) => productStation(p, state.recipes)));
    return stationOptions(state.stations).filter((o) => used.has(o.value)).map((o) => o.value);
  }
  const keys = [...new Set(state.ingredients.map((i) => ingredientGroupKey(i, groupBy)))];
  const last = groupBy === 'supplier' ? NO_SUPPLIER : NO_CATEGORY;
  return keys.sort((a, b) => (a === last ? 1 : b === last ? -1 : a.localeCompare(b, 'he')));
}

export function stationLabel(state: AppState, id: string): string {
  return stationOptions(state.stations).find((o) => o.value === id)?.label ?? UNASSIGNED_LABEL;
}

export function buildStockDoc(state: AppState, date: string, opts: StockPrintOptions, restaurantName?: string): PrintDoc {
  const columns = ['פריט', 'יחידה', 'במלאי', 'מינימום', ...(opts.blankCount ? ['ספירה'] : [])];
  const row = (item: Ingredient | Product) => [
    item.name,
    unitLabel(item.unit),
    num(item.currentQty),
    item.parLevel ? num(item.parLevel) : '',
    ...(opts.blankCount ? [''] : []),
  ];
  let sections: PrintSection[];
  if (opts.kind === 'products') {
    sections = stockGroups(state, 'products', 'station')
      .filter((g) => opts.group === ALL || g === opts.group)
      .map((g) => ({
        heading: stationLabel(state, g),
        columns,
        rows: state.products
          .filter((p) => productStation(p, state.recipes) === g)
          .sort((a, b) => a.name.localeCompare(b.name, 'he'))
          .map(row),
      }))
      .filter((s) => s.rows.length > 0);
  } else {
    const groupBy = opts.groupBy === 'supplier' ? 'supplier' : 'category';
    sections = stockGroups(state, 'ingredients', groupBy)
      .filter((g) => opts.group === ALL || g === opts.group)
      .map((g) => ({
        heading: g,
        columns,
        rows: state.ingredients
          .filter((i) => ingredientGroupKey(i, groupBy) === g)
          .sort((a, b) => a.name.localeCompare(b.name, 'he'))
          .map(row),
      }))
      .filter((s) => s.rows.length > 0);
  }
  return {
    title: `${restaurantName ? `${restaurantName} — ` : ''}${opts.kind === 'products' ? 'מלאי מוצרים' : 'מלאי מצרכים'}`,
    subtitle: fmtDate(date),
    checkboxes: false,
    pageBreaks: opts.pageBreaks,
    sections,
  };
}

// ── orders ─────────────────────────────────────────────────────────────────

export type OrderPrintOptions = {
  /** A supplier's name, or `ALL`. */
  supplier: string;
  pageBreaks: boolean;
};

/** Today's order — the same lines the morning view's approve button would submit. */
export function buildOrderDoc(
  state: AppState,
  date: string,
  opts: OrderPrintOptions,
  restaurantName?: string,
  supplierNote?: (supplier: string) => string | undefined,
): PrintDoc {
  const lines = buildOrderLines(state, {}, date);
  const bySupplier = new Map<string, string[][]>();
  for (const { ingredientId, qty } of lines) {
    const ing = state.ingredients.find((i) => i.id === ingredientId);
    if (!ing) continue;
    const supplier = ing.supplier?.trim() || NO_SUPPLIER;
    if (opts.supplier !== ALL && supplier !== opts.supplier) continue;
    bySupplier.set(supplier, [...(bySupplier.get(supplier) ?? []), [ing.name, num(qty), unitLabel(ing.unit)]]);
  }
  const sections = [...bySupplier.entries()]
    .sort(([a], [b]) => (a === NO_SUPPLIER ? 1 : b === NO_SUPPLIER ? -1 : a.localeCompare(b, 'he')))
    .map(([supplier, rows]) => ({
      heading: supplier,
      note: supplierNote?.(supplier),
      columns: ['פריט', 'כמות', 'יחידה'],
      rows: rows.sort((a, b) => a[0].localeCompare(b[0], 'he')),
    }));
  return {
    title: `${restaurantName ? `${restaurantName} — ` : ''}הזמנה`,
    subtitle: fmtDate(date),
    checkboxes: false,
    pageBreaks: opts.pageBreaks,
    sections,
  };
}

/** Suppliers that have something on today's order. */
export function orderSuppliers(state: AppState, date: string): string[] {
  const names = new Set<string>();
  for (const { ingredientId } of buildOrderLines(state, {}, date)) {
    const ing = state.ingredients.find((i) => i.id === ingredientId);
    if (ing) names.add(ing.supplier?.trim() || NO_SUPPLIER);
  }
  return [...names].sort((a, b) => (a === NO_SUPPLIER ? 1 : b === NO_SUPPLIER ? -1 : a.localeCompare(b, 'he')));
}

// ── text ───────────────────────────────────────────────────────────────────

/** The same document as plain text, for WhatsApp (`*bold*`) or the clipboard. */
export function docToText(doc: PrintDoc): string {
  const parts = [`*${doc.title}*`, doc.subtitle];
  for (const s of doc.sections) {
    parts.push('');
    parts.push(`*${s.heading}*`);
    if (s.note) parts.push(s.note);
    for (const r of s.rows) {
      const [first, ...rest] = r;
      // A quantity column reads as itself; anything else ("במלאי", "מינימום") carries its header,
      // and the unit closes the line. The blank hand-count column has no place in a message.
      let unit = '';
      const bits: string[] = [];
      rest.forEach((value, i) => {
        const header = s.columns[i + 1];
        if (!value.trim() || header === 'ספירה') return;
        if (header === 'יחידה') unit = value;
        else if (header === 'כמות' || header === 'טבח') bits.push(value);
        else bits.push(`${header} ${value}`);
      });
      const tail = bits.join(' · ') + (unit ? ` ${unit}` : '');
      parts.push(`${doc.checkboxes ? '☐ ' : '• '}${first}${tail.trim() ? ` — ${tail.trim()}` : ''}`);
    }
  }
  if (doc.sections.length === 0) parts.push('', 'אין פריטים.');
  return parts.join('\n');
}
