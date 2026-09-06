import { useMemo, useState } from 'react';
import { useApp } from '../store/AppContext';
import { orderQtyForIngredient, weeklyNeedForIngredient } from '../lib/calc';
import { formatQty } from '../lib/units';
import { EmptyState } from '../components/EmptyState';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SearchInput } from '../components/SearchInput';
import { matchesQuery } from '../lib/search';
import type { AppState, Ingredient } from '../types';

const NO_SUPPLIER = 'ללא ספק';

/** Quantity to order: the user's typed override if there is one, else the suggestion. */
function orderQtyFor(ingredient: Ingredient, state: AppState): number {
  const line = state.orderLines.find((l) => l.ingredientId === ingredient.id);
  if (line?.qtyOverride !== undefined) return line.qtyOverride;
  return Math.round(orderQtyForIngredient(ingredient.id, state) * 100) / 100;
}

function buildOrderText(state: AppState): string {
  const bySupplier = new Map<string, string[]>();
  for (const ing of state.ingredients) {
    const qty = orderQtyFor(ing, state);
    if (qty <= 0) continue;
    const supplier = ing.supplier?.trim() || NO_SUPPLIER;
    const lines = bySupplier.get(supplier) ?? [];
    lines.push(`• ${ing.name}: ${formatQty(qty, ing.unit)}`);
    bySupplier.set(supplier, lines);
  }
  return [...bySupplier.entries()]
    .map(([supplier, lines]) => `*${supplier}*\n${lines.join('\n')}`)
    .join('\n\n');
}

function ReceiveDialog({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useApp();

  const receipts = state.orderLines
    .filter((l) => l.ordered)
    .map((l) => {
      const ing = state.ingredients.find((i) => i.id === l.ingredientId);
      return ing ? { ingredientId: ing.id, qty: orderQtyFor(ing, state), ing } : null;
    })
    .filter((r): r is { ingredientId: string; qty: number; ing: Ingredient } => r !== null && r.qty > 0);

  function confirm() {
    dispatch({
      type: 'RECEIVE_ORDER',
      receipts: receipts.map(({ ingredientId, qty }) => ({ ingredientId, qty })),
    });
    onClose();
  }

  return (
    <ConfirmDialog title="קבלת סחורה" confirmLabel="הוסף למלאי" onClose={onClose} onConfirm={confirm}>
      {receipts.length === 0 ? (
        <p className="muted">לא סומן שום מצרך כ&quot;הוזמן&quot;.</p>
      ) : (
        <>
          <p className="muted">הכמויות הבאות יתווספו למלאי, והשורות יימחקו מגיליון ההזמנה:</p>
          {receipts.map(({ ing, qty }) => (
            <p key={ing.id}>
              {ing.name}: +{formatQty(qty, ing.unit)}
            </p>
          ))}
        </>
      )}
    </ConfirmDialog>
  );
}

export function Orders() {
  const { state, dispatch } = useApp();
  const [query, setQuery] = useState('');
  const [receiving, setReceiving] = useState(false);
  const [copied, setCopied] = useState(false);

  const groups = useMemo(() => {
    const filtered = state.ingredients.filter((ing) => matchesQuery(query, ing.name, ing.supplier));
    const map = new Map<string, Ingredient[]>();
    for (const ing of filtered) {
      const supplier = ing.supplier?.trim() || NO_SUPPLIER;
      map.set(supplier, [...(map.get(supplier) ?? []), ing]);
    }
    return [...map.entries()].sort(([a], [b]) =>
      a === NO_SUPPLIER ? 1 : b === NO_SUPPLIER ? -1 : a.localeCompare(b, 'he'),
    );
  }, [state.ingredients, query]);

  const orderedCount = state.orderLines.filter((l) => l.ordered).length;

  function copyList() {
    const text = buildOrderText(state);
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  }

  function shareToWhatsApp() {
    // Opens WhatsApp with the list pre-filled; the user picks the recipient and sends it.
    window.open(`https://wa.me/?text=${encodeURIComponent(buildOrderText(state))}`, '_blank');
  }

  return (
    <div>
      <div className="screen-header">
        <h1 className="screen-title">הזמנת אספקה</h1>
      </div>

      <div className="row" style={{ gap: 8, marginBottom: 'var(--space-4)' }}>
        <button type="button" className="btn" style={{ flex: 1 }} onClick={copyList}>
          {copied ? 'הועתק ✓' : 'העתק רשימה'}
        </button>
        <button type="button" className="btn" style={{ flex: 1 }} onClick={shareToWhatsApp}>
          שלח בוואטסאפ
        </button>
        <button
          type="button"
          className="btn btn-primary"
          style={{ flex: 1 }}
          disabled={orderedCount === 0}
          onClick={() => setReceiving(true)}
        >
          קבלת סחורה{orderedCount > 0 ? ` (${orderedCount})` : ''}
        </button>
      </div>

      <SearchInput value={query} onChange={setQuery} placeholder="חיפוש מצרך או ספק..." />

      {groups.length === 0 ? (
        <EmptyState text={query ? 'לא נמצאו מצרכים.' : 'אין מצרכים להזמנה.'} />
      ) : (
        <div className="card-list">
          {groups.map(([supplier, ingredients]) => (
            <div key={supplier} className="card">
              <div className="supplier-group">{supplier}</div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>מצרך</th>
                    <th>נוכחי</th>
                    <th>מינימום</th>
                    <th>שבועי</th>
                    <th>להזמנה</th>
                    <th>הוזמן</th>
                  </tr>
                </thead>
                <tbody>
                  {ingredients.map((ing) => {
                    const line = state.orderLines.find((l) => l.ingredientId === ing.id);
                    const weeklyNeed = weeklyNeedForIngredient(ing.id, state);
                    const qty = orderQtyFor(ing, state);
                    return (
                      <tr key={ing.id}>
                        <td>{ing.name}</td>
                        <td>{formatQty(ing.currentQty, ing.unit)}</td>
                        <td>
                          <input
                            type="number"
                            inputMode="decimal"
                            value={ing.parLevel ?? ''}
                            placeholder="—"
                            onChange={(e) =>
                              dispatch({
                                type: 'SET_INGREDIENT_PAR',
                                id: ing.id,
                                parLevel: parseFloat(e.target.value) || 0,
                              })
                            }
                            style={{ width: 62, border: '1px solid var(--color-border)', borderRadius: 8, padding: '6px' }}
                          />
                        </td>
                        <td>{formatQty(weeklyNeed, ing.unit)}</td>
                        <td>
                          <input
                            type="number"
                            inputMode="decimal"
                            value={qty}
                            onChange={(e) =>
                              dispatch({
                                type: 'SET_ORDER_LINE_QTY',
                                ingredientId: ing.id,
                                qtyOverride: parseFloat(e.target.value) || 0,
                              })
                            }
                            style={{ width: 72, border: '1px solid var(--color-border)', borderRadius: 8, padding: '6px' }}
                          />
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            checked={line?.ordered ?? false}
                            aria-label={`הוזמן — ${ing.name}`}
                            onChange={(e) =>
                              dispatch({
                                type: 'SET_ORDER_LINE_ORDERED',
                                ingredientId: ing.id,
                                ordered: e.target.checked,
                              })
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {state.orderLines.length > 0 && (
        <button
          type="button"
          className="btn"
          style={{ marginTop: 'var(--space-4)', color: 'var(--color-red)' }}
          onClick={() => dispatch({ type: 'CLEAR_ORDER_SHEET' })}
        >
          אפס גיליון הזמנה
        </button>
      )}

      {receiving && <ReceiveDialog onClose={() => setReceiving(false)} />}
    </div>
  );
}
