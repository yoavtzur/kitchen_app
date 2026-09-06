import { useMemo, useState } from 'react';
import { useApp } from '../store/AppContext';
import { multiplierForProduct, toPrepare, weekdayValue } from '../lib/calc';
import { addDays, dayName, dayOfWeek, todayStr, weekDates } from '../lib/date';
import { newId } from '../lib/ids';
import { WeekStrip } from '../components/WeekStrip';
import { NumberEditor } from '../components/NumberEditor';
import { BottomSheet } from '../components/BottomSheet';
import { EmptyState } from '../components/EmptyState';
import type { SpecialEvent } from '../types';

function AddEventSheet({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useApp();
  const [name, setName] = useState('');
  const [date, setDate] = useState(todayStr());
  const [selectedProducts, setSelectedProducts] = useState<Record<string, string>>({});

  function toggleQty(productId: string, value: string) {
    setSelectedProducts((prev) => ({ ...prev, [productId]: value }));
  }

  function save() {
    if (!name.trim()) return;
    const extras = Object.entries(selectedProducts)
      .map(([productId, qty]) => ({ productId, extraQty: parseFloat(qty) || 0 }))
      .filter((e) => e.extraQty > 0);
    if (extras.length === 0) return;
    const event: SpecialEvent = { id: newId('event'), name: name.trim(), date, extras };
    dispatch({ type: 'ADD_SPECIAL_EVENT', event });
    onClose();
  }

  return (
    <BottomSheet title="אירוע מיוחד" onClose={onClose}>
      <div className="field">
        <label>שם האירוע</label>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </div>
      <div className="field">
        <label>תאריך</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <h3 className="section-title">תוספת כמות למוצרים</h3>
      <div className="stack-gap-2">
        {state.products.map((p) => (
          <div key={p.id} className="row">
            <span>{p.name}</span>
            <input
              type="number"
              inputMode="decimal"
              placeholder="0"
              value={selectedProducts[p.id] ?? ''}
              onChange={(e) => toggleQty(p.id, e.target.value)}
              style={{ width: 90, border: '1px solid var(--color-border)', borderRadius: 8, padding: '8px' }}
            />
          </div>
        ))}
      </div>
      <button type="button" className="btn btn-primary" style={{ width: '100%', marginTop: 'var(--space-4)' }} onClick={save}>
        שמור אירוע
      </button>
    </BottomSheet>
  );
}

export function Consumption() {
  const { state, dispatch } = useApp();
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [weekAnchor, setWeekAnchor] = useState(todayStr());
  const [addingEvent, setAddingEvent] = useState(false);

  const dates = useMemo(() => weekDates(weekAnchor, state.settings.weekStartsOn), [weekAnchor, state.settings.weekStartsOn]);

  function goToWeek(offsetDays: number) {
    const nextAnchor = addDays(weekAnchor, offsetDays);
    setWeekAnchor(nextAnchor);
    setSelectedDate(nextAnchor);
  }

  const dayPlan = state.dayPlans.find((p) => p.date === selectedDate);

  function entryFor(productId: string) {
    return dayPlan?.entries.find((e) => e.productId === productId);
  }

  const allEventsSorted = useMemo(
    () => [...state.specialEvents].sort((a, b) => a.date.localeCompare(b.date)),
    [state.specialEvents],
  );

  function jumpToEvent(date: string) {
    setWeekAnchor(date);
    setSelectedDate(date);
  }

  return (
    <div>
      <div className="screen-header">
        <h1 className="screen-title">צריכה שבועית ויומית</h1>
      </div>

      <div className="row" style={{ marginBottom: 'var(--space-2)' }}>
        <button type="button" className="btn" onClick={() => goToWeek(-7)}>
          ◀ שבוע קודם
        </button>
        <button type="button" className="btn" onClick={() => goToWeek(7)}>
          שבוע הבא ▶
        </button>
      </div>

      <WeekStrip dates={dates} selected={selectedDate} onSelect={setSelectedDate} />

      <div className="card">
        <table className="data-table">
          <thead>
            <tr>
              <th>מוצר</th>
              <th>שבועי</th>
              <th>יומי ({dayName(selectedDate)})</th>
              <th>נוכחי</th>
              <th>הכנה להיום</th>
              <th>משימה</th>
            </tr>
          </thead>
          <tbody>
            {state.products.map((product) => {
              const prep = toPrepare(product, selectedDate, state);
              const entry = entryFor(product.id);
              const isManual = entry?.prepOverride !== undefined;
              const recipe = state.recipes.find((r) => r.id === product.recipeId);
              const { multiplier, unitMismatch } = recipe
                ? multiplierForProduct(product, recipe, prep, state.settings.roundMultiplierTo)
                : { multiplier: 0, unitMismatch: false };
              // "יומי" here edits THIS weekday's usage, not the product's general default —
              // the default stays editable from the prep-item editor. That turns the existing
              // per-date view into exactly the place to say "Friday needs more than Monday".
              const weekday = dayOfWeek(selectedDate);
              const weekdayOverride = product.dailyUsageByWeekday?.[weekday];
              const effectiveDaily = weekdayValue(product.dailyUsage, product.dailyUsageByWeekday, selectedDate);
              return (
                <tr key={product.id}>
                  <td>{product.name}</td>
                  <td>
                    <NumberEditor
                      value={product.weeklyTarget}
                      label={`צריכה שבועית — ${product.name}`}
                      onChange={(weeklyTarget) =>
                        dispatch({ type: 'SET_PRODUCT_TARGETS', id: product.id, weeklyTarget })
                      }
                    />
                  </td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      <NumberEditor
                        value={effectiveDaily}
                        label={`צריכה יומית — ${product.name} (יום ${dayName(selectedDate)})`}
                        onChange={(dailyUsage) =>
                          dispatch({ type: 'SET_PRODUCT_WEEKDAY_USAGE', id: product.id, weekday, dailyUsage })
                        }
                      />
                      {weekdayOverride !== undefined && (
                        <button
                          type="button"
                          className="pill yellow"
                          style={{ border: 'none' }}
                          title="איפוס לברירת מחדל"
                          onClick={() =>
                            dispatch({
                              type: 'SET_PRODUCT_WEEKDAY_USAGE',
                              id: product.id,
                              weekday,
                              dailyUsage: undefined,
                            })
                          }
                        >
                          מותאם ↺
                        </button>
                      )}
                    </div>
                  </td>
                  <td>{product.currentQty}</td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      <NumberEditor
                        value={prep}
                        label={`הכנה להיום — ${product.name}`}
                        onChange={(prepOverride) =>
                          dispatch({
                            type: 'SET_DAY_PLAN_ENTRY',
                            date: selectedDate,
                            entry: { productId: product.id, prepOverride },
                          })
                        }
                      />
                      {isManual && (
                        <button
                          type="button"
                          className="pill yellow"
                          style={{ border: 'none' }}
                          title="איפוס לחישוב אוטומטי"
                          onClick={() =>
                            dispatch({
                              type: 'SET_DAY_PLAN_ENTRY',
                              date: selectedDate,
                              entry: { productId: product.id, prepOverride: null },
                            })
                          }
                        >
                          ידני ↺
                        </button>
                      )}
                    </div>
                  </td>
                  <td>
                    {recipe && unitMismatch ? (
                      <span className="pill red">יחידה לא תואמת</span>
                    ) : recipe && multiplier > 0 ? (
                      <span className="pill green">
                        {recipe.name} ×{multiplier}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="screen-header" style={{ marginTop: 'var(--space-5)' }}>
        <h2 className="section-title" style={{ margin: 0 }}>כל האירועים המיוחדים</h2>
        <button type="button" className="btn" onClick={() => setAddingEvent(true)}>
          + הוסף אירוע
        </button>
      </div>

      {allEventsSorted.length === 0 ? (
        <EmptyState text="אין אירועים מיוחדים מתוכננים." />
      ) : (
        <div className="card-list">
          {allEventsSorted.map((ev) => {
            const [, m, d] = ev.date.split('-');
            return (
              <div key={ev.id} className={`card ${ev.date === selectedDate ? 'priority-card green' : ''}`}>
                <div className="row">
                  <button
                    type="button"
                    onClick={() => jumpToEvent(ev.date)}
                    style={{ background: 'none', border: 'none', padding: 0, textAlign: 'start', cursor: 'pointer' }}
                  >
                    <span style={{ fontWeight: 600 }}>{ev.name}</span>
                    <span className="muted" style={{ marginInlineStart: 8 }}>
                      יום {dayName(ev.date)}, {d}/{m}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-icon"
                    onClick={() => dispatch({ type: 'DELETE_SPECIAL_EVENT', id: ev.id })}
                  >
                    ✕
                  </button>
                </div>
                <div className="stack-gap-2" style={{ marginTop: 'var(--space-2)' }}>
                  {ev.extras.map((extra) => {
                    const product = state.products.find((p) => p.id === extra.productId);
                    return (
                      <p key={extra.productId} className="muted">
                        {product?.name ?? extra.productId}: +{extra.extraQty}
                      </p>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {addingEvent && <AddEventSheet onClose={() => setAddingEvent(false)} />}
    </div>
  );
}
