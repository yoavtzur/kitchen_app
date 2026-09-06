import { useMemo, useState } from 'react';
import { useApp } from '../store/AppContext';
import { EmptyState } from '../components/EmptyState';
import { SearchInput } from '../components/SearchInput';
import { matchesQuery } from '../lib/search';
import { todayStr } from '../lib/date';
import { unitLabel } from '../lib/units';
import type { Ingredient, Product, Unit } from '../types';

type Draft = Record<string, string>;

/** A pending update: only entries whose typed value actually differs from what's stored. */
function collectChanges<T extends { id: string; currentQty: number }>(
  items: T[],
  drafts: Draft,
): { id: string; qty: number }[] {
  return items
    .filter((item) => drafts[item.id] !== undefined)
    .map((item) => ({ id: item.id, qty: parseFloat(drafts[item.id]) }))
    .filter((u) => !Number.isNaN(u.qty) && u.qty !== items.find((i) => i.id === u.id)?.currentQty);
}

function isChanged(id: string, currentQty: number, drafts: Draft): boolean {
  const draft = drafts[id];
  if (draft === undefined) return false;
  const parsed = parseFloat(draft);
  return !Number.isNaN(parsed) && parsed !== currentQty;
}

type CountRow = { id: string; name: string; currentQty: number; unit: Unit };

function CountTable({
  label,
  rows,
  drafts,
  onDraftChange,
}: {
  label: string;
  rows: CountRow[];
  drafts: Draft;
  onDraftChange: (id: string, value: string) => void;
}) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>{label}</th>
          <th>ספירה</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className={isChanged(row.id, row.currentQty, drafts) ? 'count-row-changed' : undefined}>
            <td>{row.name}</td>
            <td>
              <div className="row" style={{ gap: 6, justifyContent: 'flex-start' }}>
                <input
                  type="number"
                  inputMode="decimal"
                  value={drafts[row.id] ?? String(row.currentQty)}
                  onChange={(e) => onDraftChange(row.id, e.target.value)}
                  style={{ width: 90, border: '1px solid var(--color-border)', borderRadius: 8, padding: '6px' }}
                />
                <span className="muted">{unitLabel(row.unit)}</span>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function toRows(items: (Ingredient | Product)[]): CountRow[] {
  return items.map((item) => ({ id: item.id, name: item.name, currentQty: item.currentQty, unit: item.unit }));
}

/**
 * A single walk-through of every ingredient and product to record today's counted stock,
 * committed in one batch instead of opening each item's editor separately. Product updates
 * go through the exact same BULK_UPDATE_QUANTITIES → applyProductQtyUpdate path SET_PRODUCT_QTY
 * uses, so a count here clears a stale prep override and resurfaces a dismissed task exactly
 * like editing the product by hand would.
 */
export function StockCount() {
  const { state, dispatch } = useApp();
  const [query, setQuery] = useState('');
  const [ingredientDrafts, setIngredientDrafts] = useState<Draft>({});
  const [productDrafts, setProductDrafts] = useState<Draft>({});
  const [justSaved, setJustSaved] = useState(false);

  const filteredIngredients = state.ingredients.filter((ing) => matchesQuery(query, ing.name, ing.supplier));
  const filteredProducts = state.products.filter((p) => matchesQuery(query, p.name));
  const menuProducts = filteredProducts.filter((p) => p.kind === 'menu');
  const componentProducts = filteredProducts.filter((p) => p.kind === 'component');

  const changedIngredients = useMemo(
    () => collectChanges(state.ingredients, ingredientDrafts),
    [state.ingredients, ingredientDrafts],
  );
  const changedProducts = useMemo(
    () => collectChanges(state.products, productDrafts),
    [state.products, productDrafts],
  );
  const changeCount = changedIngredients.length + changedProducts.length;

  function save() {
    dispatch({
      type: 'BULK_UPDATE_QUANTITIES',
      ingredients: changedIngredients,
      products: changedProducts,
      today: todayStr(),
    });
    setIngredientDrafts({});
    setProductDrafts({});
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2500);
  }

  const nothingToCount = state.ingredients.length === 0 && state.products.length === 0;
  const nothingFound = !nothingToCount && filteredIngredients.length === 0 && filteredProducts.length === 0;

  return (
    <div>
      <div className="screen-header">
        <h1 className="screen-title">ספירת מלאי</h1>
      </div>
      <p className="muted" style={{ marginBottom: 'var(--space-4)' }}>
        עברו על הרשימה, הזינו את הכמות שנספרה בפועל, ושמרו הכל בבת אחת בסוף.
      </p>

      <SearchInput value={query} onChange={setQuery} placeholder="חיפוש מצרך או מוצר..." />

      {nothingToCount ? (
        <EmptyState text="אין עדיין מצרכים או מוצרים לספור." />
      ) : nothingFound ? (
        <EmptyState text="לא נמצאו פריטים." />
      ) : (
        <>
          {filteredIngredients.length > 0 && (
            <>
              <h2 className="section-title">מצרכים</h2>
              <div className="card">
                <CountTable
                  label="מצרך"
                  rows={toRows(filteredIngredients)}
                  drafts={ingredientDrafts}
                  onDraftChange={(id, value) => setIngredientDrafts((prev) => ({ ...prev, [id]: value }))}
                />
              </div>
            </>
          )}
          {menuProducts.length > 0 && (
            <>
              <h2 className="section-title">מנות בתפריט</h2>
              <div className="card">
                <CountTable
                  label="מנה"
                  rows={toRows(menuProducts)}
                  drafts={productDrafts}
                  onDraftChange={(id, value) => setProductDrafts((prev) => ({ ...prev, [id]: value }))}
                />
              </div>
            </>
          )}
          {componentProducts.length > 0 && (
            <>
              <h2 className="section-title">מוצרים</h2>
              <div className="card">
                <CountTable
                  label="מוצר"
                  rows={toRows(componentProducts)}
                  drafts={productDrafts}
                  onDraftChange={(id, value) => setProductDrafts((prev) => ({ ...prev, [id]: value }))}
                />
              </div>
            </>
          )}
        </>
      )}

      {justSaved && changeCount === 0 && (
        <p className="pill green" style={{ marginTop: 'var(--space-4)' }}>
          הספירה נשמרה ✓
        </p>
      )}

      {changeCount > 0 && (
        <div className="count-save-bar">
          <button type="button" className="btn btn-primary" onClick={save}>
            שמור ספירה ({changeCount})
          </button>
        </div>
      )}
    </div>
  );
}
