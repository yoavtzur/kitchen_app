import { useState } from 'react';
import { useApp } from '../store/AppContext';
import { daysOfSupply } from '../lib/calc';
import { todayStr } from '../lib/date';
import { newId } from '../lib/ids';
import { canConvert, unitLabel } from '../lib/units';
import { NumberEditor } from '../components/NumberEditor';
import { BottomSheet } from '../components/BottomSheet';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { SearchInput } from '../components/SearchInput';
import { WeekdayUsageEditor } from '../components/WeekdayUsageEditor';
import { matchesQuery } from '../lib/search';
import { describeImpact, impactOfDeletingIngredient } from '../lib/integrity';
import type { Ingredient, Weekday, Unit } from '../types';

const UNIT_OPTIONS: { value: Unit; label: string }[] = [
  { value: 'kg', label: 'ק"ג' },
  { value: 'g', label: 'גרם' },
  { value: 'l', label: 'ליטר' },
  { value: 'ml', label: 'מ"ל' },
  { value: 'unit', label: "יח'" },
];

function coverageColor(days: number): 'red' | 'yellow' | 'green' {
  if (days < 1) return 'red';
  if (days < 3) return 'yellow';
  return 'green';
}

function UnitPickerSheet({
  ingredient,
  onClose,
  onPick,
}: {
  ingredient: Ingredient;
  onClose: () => void;
  onPick: (unit: Unit) => void;
}) {
  return (
    <BottomSheet title={`יחידת מידה — ${ingredient.name}`} onClose={onClose}>
      <div className="stack-gap-2">
        {UNIT_OPTIONS.map((u) => (
          <button
            key={u.value}
            type="button"
            className="row-item"
            style={{ width: '100%', textAlign: 'start', border: 'none', background: 'none', cursor: 'pointer' }}
            onClick={() => onPick(u.value)}
          >
            <span>{u.label}</span>
            {u.value === ingredient.unit && <span className="muted">נוכחי</span>}
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}

function IngredientDetailSheet({ ingredient, onClose }: { ingredient: Ingredient; onClose: () => void }) {
  const { state, dispatch } = useApp();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pickingUnit, setPickingUnit] = useState(false);
  // Set only for a cross-family change (e.g. weight -> count), where SET_INGREDIENT_UNIT can't
  // convert the existing numbers automatically — see the comment on that case in reducer.ts.
  const [pendingUnit, setPendingUnit] = useState<Unit | null>(null);

  function handlePickUnit(unit: Unit) {
    setPickingUnit(false);
    if (unit === ingredient.unit) return;
    if (canConvert(ingredient.unit, unit)) {
      dispatch({ type: 'SET_INGREDIENT_UNIT', id: ingredient.id, unit });
    } else {
      setPendingUnit(unit);
    }
  }

  return (
    <BottomSheet title={ingredient.name} onClose={onClose}>
      <div className="row-item">
        <span>צריכה יומית</span>
        <NumberEditor
          value={ingredient.dailyUsage}
          label={`צריכה יומית — ${ingredient.name}`}
          suffix={unitLabel(ingredient.unit)}
          onChange={(dailyUsage) =>
            dispatch({ type: 'SET_INGREDIENT_USAGE', id: ingredient.id, dailyUsage })
          }
        />
      </div>
      <div className="row-item">
        <span>צריכה שבועית</span>
        <NumberEditor
          value={ingredient.weeklyUsage}
          label={`צריכה שבועית — ${ingredient.name}`}
          suffix={unitLabel(ingredient.unit)}
          onChange={(weeklyUsage) =>
            dispatch({ type: 'SET_INGREDIENT_USAGE', id: ingredient.id, weeklyUsage })
          }
        />
      </div>
      <div className="field">
        <label>צריכה יומית לפי יום (ריק = ברירת מחדל {ingredient.dailyUsage})</label>
        <WeekdayUsageEditor
          base={ingredient.dailyUsage}
          overrides={ingredient.dailyUsageByWeekday}
          onChange={(weekday: Weekday, value: number | undefined) =>
            dispatch({ type: 'SET_INGREDIENT_WEEKDAY_USAGE', id: ingredient.id, weekday, dailyUsage: value })
          }
        />
      </div>
      <div className="row-item">
        <span>מלאי מינימום</span>
        <NumberEditor
          value={ingredient.parLevel ?? 0}
          label={`מלאי מינימום — ${ingredient.name}`}
          suffix={unitLabel(ingredient.unit)}
          onChange={(parLevel) => dispatch({ type: 'SET_INGREDIENT_PAR', id: ingredient.id, parLevel })}
        />
      </div>
      <div className="row-item">
        <span>יחידת מידה</span>
        <button type="button" className="btn" onClick={() => setPickingUnit(true)}>
          {unitLabel(ingredient.unit)}
        </button>
      </div>
      {ingredient.supplier && (
        <div className="row-item">
          <span>ספק</span>
          <span className="muted">{ingredient.supplier}</span>
        </div>
      )}
      <button
        type="button"
        className="btn"
        style={{ marginTop: 'var(--space-4)', color: 'var(--color-red)' }}
        onClick={() => setConfirmingDelete(true)}
      >
        מחק מצרך
      </button>

      {confirmingDelete && (
        <ConfirmDialog
          title={`מחיקת "${ingredient.name}"`}
          confirmLabel="מחק לצמיתות"
          onClose={() => setConfirmingDelete(false)}
          onConfirm={() => {
            dispatch({ type: 'DELETE_INGREDIENT', id: ingredient.id });
            onClose();
          }}
        >
          <p>המצרך יימחק מכל האפליקציה. מה שיושפע:</p>
          {describeImpact(impactOfDeletingIngredient(ingredient.id, state)).map((line, i) => (
            <p key={i} className="muted">
              • {line}
            </p>
          ))}
        </ConfirmDialog>
      )}

      {pickingUnit && (
        <UnitPickerSheet ingredient={ingredient} onClose={() => setPickingUnit(false)} onPick={handlePickUnit} />
      )}

      {pendingUnit && (
        <ConfirmDialog
          title="שינוי יחידת מידה"
          confirmLabel="שנה בכל זאת"
          onClose={() => setPendingUnit(null)}
          onConfirm={() => {
            dispatch({ type: 'SET_INGREDIENT_UNIT', id: ingredient.id, unit: pendingUnit });
            setPendingUnit(null);
          }}
        >
          <p>
            אי אפשר להמיר אוטומטית בין {unitLabel(ingredient.unit)} ל-{unitLabel(pendingUnit)} — אלו יחידות
            ממשפחות שונות (משקל / נפח / יחידות). הכמויות (מלאי, צריכה, מלאי מינימום) יישארו באותו מספר אבל
            יתויגו ביחידה החדשה — כדאי לבדוק ולתקן אותן ידנית אחרי השינוי.
          </p>
        </ConfirmDialog>
      )}
    </BottomSheet>
  );
}

function AddIngredientSheet({ onClose }: { onClose: () => void }) {
  const { dispatch } = useApp();
  const [name, setName] = useState('');
  const [unit, setUnit] = useState<Unit>('kg');
  const [currentQty, setCurrentQty] = useState('0');
  const [dailyUsage, setDailyUsage] = useState('0');
  const [weeklyUsage, setWeeklyUsage] = useState('0');
  const [parLevel, setParLevel] = useState('');
  const [supplier, setSupplier] = useState('');

  function save() {
    if (!name.trim()) return;
    const parsedPar = parseFloat(parLevel);
    dispatch({
      type: 'ADD_INGREDIENT',
      ingredient: {
        id: newId('ing'),
        name: name.trim(),
        unit,
        currentQty: parseFloat(currentQty) || 0,
        dailyUsage: parseFloat(dailyUsage) || 0,
        weeklyUsage: parseFloat(weeklyUsage) || 0,
        parLevel: Number.isNaN(parsedPar) ? undefined : parsedPar,
        supplier: supplier.trim() || undefined,
      },
    });
    onClose();
  }

  return (
    <BottomSheet title="הוספת מצרך" onClose={onClose}>
      <div className="field">
        <label>שם המצרך</label>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </div>
      <div className="field">
        <label>יחידת מידה</label>
        <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
          {UNIT_OPTIONS.map((u) => (
            <option key={u.value} value={u.value}>
              {u.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>כמות נוכחית</label>
        <input type="number" inputMode="decimal" value={currentQty} onChange={(e) => setCurrentQty(e.target.value)} />
      </div>
      <div className="field">
        <label>צריכה יומית</label>
        <input type="number" inputMode="decimal" value={dailyUsage} onChange={(e) => setDailyUsage(e.target.value)} />
      </div>
      <div className="field">
        <label>צריכה שבועית</label>
        <input type="number" inputMode="decimal" value={weeklyUsage} onChange={(e) => setWeeklyUsage(e.target.value)} />
      </div>
      <div className="field">
        <label>מלאי מינימום (לא חובה)</label>
        <input type="number" inputMode="decimal" value={parLevel} onChange={(e) => setParLevel(e.target.value)} />
      </div>
      <div className="field">
        <label>ספק (לא חובה)</label>
        <input value={supplier} onChange={(e) => setSupplier(e.target.value)} />
      </div>
      <button type="button" className="btn btn-primary" style={{ width: '100%' }} onClick={save}>
        הוסף מצרך
      </button>
    </BottomSheet>
  );
}

export function Ingredients() {
  const { state, dispatch } = useApp();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');

  const detailIngredient = state.ingredients.find((i) => i.id === detailId) ?? null;
  const filtered = state.ingredients.filter((ing) => matchesQuery(query, ing.name, ing.supplier));

  return (
    <div>
      <div className="screen-header">
        <h1 className="screen-title">כמות מצרכים</h1>
        <button type="button" className="btn btn-icon btn-primary" onClick={() => setAdding(true)} aria-label="הוסף מצרך">
          +
        </button>
      </div>

      <SearchInput value={query} onChange={setQuery} placeholder="חיפוש מצרך או ספק..." />

      {filtered.length === 0 ? (
        <EmptyState
          text={
            state.ingredients.length === 0
              ? 'אין עדיין מצרכים. הוסף מצרך כדי להתחיל.'
              : 'לא נמצאו מצרכים.'
          }
        />
      ) : (
        <div className="card">
          <table className="data-table">
            <thead>
              <tr>
                <th>שם המצרך</th>
                <th>כמות נוכחית</th>
                <th>מספיק ל-</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((ing) => {
                const days = daysOfSupply(ing, todayStr());
                const color = coverageColor(days);
                return (
                  <tr key={ing.id}>
                    <td>
                      <button
                        type="button"
                        onClick={() => setDetailId(ing.id)}
                        style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit', textAlign: 'start' }}
                      >
                        {ing.name}
                      </button>
                    </td>
                    <td>
                      <NumberEditor
                        value={ing.currentQty}
                        label={`כמות נוכחית — ${ing.name}`}
                        suffix={unitLabel(ing.unit)}
                        onChange={(qty) => dispatch({ type: 'SET_INGREDIENT_QTY', id: ing.id, qty })}
                      />
                    </td>
                    <td>
                      <span className={`pill ${color}`}>
                        {days === Infinity ? '∞' : `${Math.round(days * 10) / 10} ימים`}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {detailIngredient && (
        <IngredientDetailSheet ingredient={detailIngredient} onClose={() => setDetailId(null)} />
      )}
      {adding && <AddIngredientSheet onClose={() => setAdding(false)} />}
    </div>
  );
}
