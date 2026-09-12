import { useMemo, useState } from 'react';
import { useApp } from '../store/AppContext';
import { orderQtyForIngredient, weeklyNeedForIngredient } from '../lib/calc';
import { formatQty } from '../lib/units';
import { addDays, dayOfWeek, dayShortLabel, orderLineKey, todayStr } from '../lib/date';
import { EmptyState } from '../components/EmptyState';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SearchInput } from '../components/SearchInput';
import { CategoryTabs } from '../components/CategoryTabs';
import { matchesQuery } from '../lib/search';
import type { AppState, Ingredient } from '../types';

const NO_SUPPLIER = 'ללא ספק';

/** Quantity to order today: the user's typed override if there is one, else the suggestion. */
function orderQtyFor(ingredient: Ingredient, date: string, state: AppState): number {
  const line = state.orderLines.find((l) => l.ingredientId === ingredient.id && l.date === date);
  if (line?.qtyOverride !== undefined) return line.qtyOverride;
  return Math.round(orderQtyForIngredient(ingredient.id, state) * 100) / 100;
}

function buildOrderText(date: string, state: AppState): string {
  const bySupplier = new Map<string, string[]>();
  for (const ing of state.ingredients) {
    const qty = orderQtyFor(ing, date, state);
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

function ReceiveDialog({ date, onClose }: { date: string; onClose: () => void }) {
  const { state, dispatch } = useApp();

  const receipts = state.orderLines
    .filter((l) => l.date === date && l.ordered)
    .map((l) => {
      const ing = state.ingredients.find((i) => i.id === l.ingredientId);
      return ing ? { ingredientId: ing.id, qty: orderQtyFor(ing, date, state), ing } : null;
    })
    .filter((r): r is { ingredientId: string; qty: number; ing: Ingredient } => r !== null && r.qty > 0);

  function confirm() {
    dispatch({
      type: 'RECEIVE_ORDER',
      date,
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

function CurrentOrder() {
  const { state, dispatch } = useApp();
  const date = todayStr();
  const [query, setQuery] = useState('');
  const [receiving, setReceiving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [submitted, setSubmitted] = useState(false);

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

  const todaysLines = state.orderLines.filter((l) => l.date === date);
  const orderedCount = todaysLines.filter((l) => l.ordered).length;

  function copyList() {
    const text = buildOrderText(date, state);
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
    window.open(`https://wa.me/?text=${encodeURIComponent(buildOrderText(date, state))}`, '_blank');
  }

  function submitOrder() {
    const lines = state.ingredients
      .map((ing) => ({ ingredientId: ing.id, qty: orderQtyFor(ing, date, state) }))
      .filter((l) => l.qty > 0);
    if (lines.length === 0) return;
    dispatch({ type: 'SUBMIT_ORDER', date, lines });
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 2000);
  }

  return (
    <div>
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
                    const line = state.orderLines.find((l) => l.ingredientId === ing.id && l.date === date);
                    const weeklyNeed = weeklyNeedForIngredient(ing.id, state);
                    const qty = orderQtyFor(ing, date, state);
                    return (
                      <tr key={ing.id}>
                        <td>
                          <div>{ing.name}</div>
                          {ing.category && (
                            <div className="muted" style={{ fontSize: 11 }}>{ing.category}</div>
                          )}
                        </td>
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
                                date,
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
                                date,
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

      <button
        type="button"
        className="btn btn-primary"
        style={{ width: '100%', marginTop: 'var(--space-4)' }}
        onClick={submitOrder}
      >
        {submitted ? 'ההזמנה נשלחה ✓' : 'שלח הזמנה'}
      </button>

      {todaysLines.length > 0 && (
        <button
          type="button"
          className="btn"
          style={{ marginTop: 'var(--space-3)', color: 'var(--color-red)' }}
          onClick={() => dispatch({ type: 'CLEAR_ORDER_SHEET', date })}
        >
          אפס גיליון הזמנה
        </button>
      )}

      {receiving && <ReceiveDialog date={date} onClose={() => setReceiving(false)} />}
    </div>
  );
}

const HISTORY_DAYS = 7;

function OrderHistory() {
  const { state } = useApp();
  const today = todayStr();
  const dates = useMemo(
    () => Array.from({ length: HISTORY_DAYS }, (_, i) => addDays(today, -(HISTORY_DAYS - 1 - i))),
    [today],
  );
  const dateSet = new Set(dates);

  const rows = useMemo(() => {
    const ingredientIds = new Set(
      state.orderLines.filter((l) => dateSet.has(l.date)).map((l) => l.ingredientId),
    );
    return state.ingredients.filter((ing) => ingredientIds.has(ing.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.orderLines, state.ingredients, today]);

  function valueFor(ingredientId: string, date: string): number | undefined {
    const line = state.orderLines.find((l) => l.ingredientId === ingredientId && l.date === date);
    return line?.qtyOverride;
  }

  function highlightFor(ingredientId: string, value: number | undefined): 'red' | 'yellow' | undefined {
    if (value === undefined) return undefined;
    const values = dates
      .map((d) => valueFor(ingredientId, d))
      .filter((v): v is number => v !== undefined);
    if (values.length < 3) return undefined;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    if (mean <= 0) return undefined;
    if (value > mean * 2) return 'red';
    if (value > mean * 1.5) return 'yellow';
    return undefined;
  }

  if (rows.length === 0) return <EmptyState text="אין עדיין היסטוריית הזמנות בשבוע האחרון." />;

  return (
    <div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>מצרך</th>
              {dates.map((d) => (
                <th key={d}>{dayShortLabel(dayOfWeek(d))}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((ing) => (
              <tr key={ing.id}>
                <td>{ing.name}</td>
                {dates.map((d) => {
                  const value = valueFor(ing.id, d);
                  const highlight = highlightFor(ing.id, value);
                  return (
                    <td key={orderLineKey(ing.id, d)}>
                      {value === undefined ? (
                        <span className="muted">—</span>
                      ) : highlight ? (
                        <span className={`pill ${highlight}`}>{formatQty(value, ing.unit)}</span>
                      ) : (
                        formatQty(value, ing.unit)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ marginTop: 'var(--space-3)' }}>
        מסומן בצהוב: כמות גבוהה פי 1.5 מהממוצע השבועי של המצרך. באדום: פי 2 ומעלה. שורה עם פחות
        משלוש נקודות מידע אינה מסומנת.
      </p>
    </div>
  );
}

type OrdersTab = 'current' | 'history';

const TABS: { value: OrdersTab; label: string }[] = [
  { value: 'current', label: 'הזמנה נוכחית' },
  { value: 'history', label: 'היסטוריה שבועית' },
];

export function Orders() {
  const [tab, setTab] = useState<OrdersTab>('current');

  return (
    <div>
      <div className="screen-header">
        <h1 className="screen-title">הזמנת אספקה</h1>
      </div>

      <CategoryTabs tabs={TABS} value={tab} onChange={setTab} />

      {tab === 'current' ? <CurrentOrder /> : <OrderHistory />}
    </div>
  );
}
