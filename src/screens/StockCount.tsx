import { useMemo, useState } from 'react';
import { useApp } from '../store/AppContext';
import { coverageColor, daysOfSupply } from '../lib/calc';
import { EmptyState } from '../components/EmptyState';
import { SearchInput } from '../components/SearchInput';
import { NumberEditor } from '../components/NumberEditor';
import { BottomSheet } from '../components/BottomSheet';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { WeekdayUsageEditor } from '../components/WeekdayUsageEditor';
import { matchesQuery } from '../lib/search';
import { todayStr } from '../lib/date';
import { newId } from '../lib/ids';
import { canConvert, unitLabel } from '../lib/units';
import { describeImpact, impactOfDeletingIngredient } from '../lib/integrity';
import type { Ingredient, Product, Unit, Weekday } from '../types';

const UNIT_OPTIONS: { value: Unit; label: string }[] = [
  { value: 'kg', label: 'ק"ג' },
  { value: 'g', label: 'גרם' },
  { value: 'l', label: 'ליטר' },
  { value: 'ml', label: 'מ"ל' },
  { value: 'unit', label: "יח'" },
];

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

/** Effective quantity for a row: the pending draft when it's a usable number, else what's stored. */
function effectiveQty(item: { id: string; currentQty: number }, drafts: Draft): number {
  const draft = drafts[item.id];
  if (draft === undefined) return item.currentQty;
  const parsed = parseFloat(draft);
  return Number.isNaN(parsed) ? item.currentQty : parsed;
}

/**
 * "מספיק ל-" at the counted quantity. Renders an em dash rather than ∞ when the ingredient has no
 * daily consumption configured: "unknown" is the honest reading, and an ∞ pill next to an empty
 * shelf reads as reassurance.
 */
function CoverageCell({ ingredient, qty, today }: { ingredient: Ingredient; qty: number; today: string }) {
  const days = daysOfSupply({ ...ingredient, currentQty: qty }, today);
  if (!Number.isFinite(days)) return <span className="muted">—</span>;
  return <span className={`pill ${coverageColor(days)}`}>{Math.round(days * 10) / 10} ימים</span>;
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
              <div className="count-qty-cell">
                <input
                  className="count-input"
                  type="number"
                  inputMode="decimal"
                  aria-label={`ספירה — ${row.name}`}
                  value={drafts[row.id] ?? String(row.currentQty)}
                  onChange={(e) => onDraftChange(row.id, e.target.value)}
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

function IngredientCountTable({
  ingredients,
  drafts,
  today,
  onDraftChange,
  onOpenDetail,
}: {
  ingredients: Ingredient[];
  drafts: Draft;
  today: string;
  onDraftChange: (id: string, value: string) => void;
  onOpenDetail: (id: string) => void;
}) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>מצרך</th>
          <th>ספירה</th>
          <th>מספיק ל-</th>
        </tr>
      </thead>
      <tbody>
        {ingredients.map((ing) => (
          <tr key={ing.id} className={isChanged(ing.id, ing.currentQty, drafts) ? 'count-row-changed' : undefined}>
            <td>
              <button
                type="button"
                className="count-name-btn"
                onClick={() => onOpenDetail(ing.id)}
                aria-label={`פרטי ${ing.name}`}
              >
                <span>{ing.name}</span>
              </button>
            </td>
            <td>
              <div className="count-qty-cell">
                <input
                  className="count-input"
                  type="number"
                  inputMode="decimal"
                  aria-label={`ספירה — ${ing.name}`}
                  value={drafts[ing.id] ?? String(ing.currentQty)}
                  onChange={(e) => onDraftChange(ing.id, e.target.value)}
                />
                <span className="muted">{unitLabel(ing.unit)}</span>
              </div>
            </td>
            <td>
              <CoverageCell ingredient={ing} qty={effectiveQty(ing, drafts)} today={today} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
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
  const [nameDraft, setNameDraft] = useState(ingredient.name);
  const [supplierDraft, setSupplierDraft] = useState(ingredient.supplier ?? '');
  const [categoryDraft, setCategoryDraft] = useState(ingredient.category ?? '');

  function handlePickUnit(unit: Unit) {
    setPickingUnit(false);
    if (unit === ingredient.unit) return;
    if (canConvert(ingredient.unit, unit)) {
      dispatch({ type: 'SET_INGREDIENT_UNIT', id: ingredient.id, unit });
    } else {
      setPendingUnit(unit);
    }
  }

  function commitName() {
    const name = nameDraft.trim();
    if (!name || name === ingredient.name) {
      setNameDraft(ingredient.name);
      return;
    }
    dispatch({ type: 'UPDATE_INGREDIENT', ingredient: { ...ingredient, name } });
  }

  function commitSupplier() {
    const supplier = supplierDraft.trim() || undefined;
    if (supplier === ingredient.supplier) return;
    // Ops are JSON-serialized and JSON drops `undefined` keys — for this whole-object replace
    // that's exactly right (the key vanishes, meaning no supplier). Don't "fix" this to `null`,
    // or the string "null" will render wherever a supplier is shown.
    dispatch({ type: 'UPDATE_INGREDIENT', ingredient: { ...ingredient, supplier } });
  }

  function commitCategory() {
    const category = categoryDraft.trim() || undefined;
    if (category === ingredient.category) return;
    // Same undefined-key reasoning as commitSupplier above — an empty category clears the key
    // entirely rather than storing "null".
    dispatch({ type: 'UPDATE_INGREDIENT', ingredient: { ...ingredient, category } });
  }

  return (
    <BottomSheet title={ingredient.name} onClose={onClose}>
      <div className="field">
        <label>שם המצרך</label>
        <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onBlur={commitName} />
      </div>
      <div className="field">
        <label>ספק (לא חובה)</label>
        <input value={supplierDraft} onChange={(e) => setSupplierDraft(e.target.value)} onBlur={commitSupplier} />
      </div>
      <div className="field">
        <label>קטגוריה (לא חובה)</label>
        <input value={categoryDraft} onChange={(e) => setCategoryDraft(e.target.value)} onBlur={commitCategory} />
      </div>
      <div className="row-item">
        <span>כמות במלאי</span>
        <span className="muted">
          {ingredient.currentQty} {unitLabel(ingredient.unit)}
        </span>
      </div>
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
  const [category, setCategory] = useState('');

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
        category: category.trim() || undefined,
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
      <div className="field">
        <label>קטגוריה (לא חובה)</label>
        <input value={category} onChange={(e) => setCategory(e.target.value)} />
      </div>
      <button type="button" className="btn btn-primary" style={{ width: '100%' }} onClick={save}>
        הוסף מצרך
      </button>
    </BottomSheet>
  );
}

/**
 * A single walk-through of every ingredient and product to record today's counted stock,
 * committed in one batch instead of opening each item's editor separately. Product updates
 * go through the exact same BULK_UPDATE_QUANTITIES → applyProductQtyUpdate path SET_PRODUCT_QTY
 * uses, so a count here clears a stale prep override and resurfaces a dismissed task exactly
 * like editing the product by hand would.
 *
 * Ingredients additionally carry the full editor (name/supplier/usage/par/unit/delete) in a detail
 * sheet, and a live "מספיק ל-" coverage column. Tapping an ingredient's name first flushes that
 * one row's pending count as a single-item BULK_UPDATE_QUANTITIES, then opens the sheet — so the
 * sheet always shows committed truth. This matters beyond cosmetics: a unit change inside the sheet
 * converts the *stored* quantity, so a draft still typed in the old unit would otherwise be
 * committed later by the save bar as a raw number against the new unit.
 */
export function StockCount() {
  const { state, dispatch } = useApp();
  const [query, setQuery] = useState('');
  const [ingredientDrafts, setIngredientDrafts] = useState<Draft>({});
  const [productDrafts, setProductDrafts] = useState<Draft>({});
  const [justSaved, setJustSaved] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const today = todayStr();

  const detailIngredient = state.ingredients.find((i) => i.id === detailId) ?? null;

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
      today,
    });
    setIngredientDrafts({});
    setProductDrafts({});
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2500);
  }

  function openDetail(id: string) {
    const ing = state.ingredients.find((i) => i.id === id);
    const draft = ingredientDrafts[id];
    if (ing && draft !== undefined) {
      const qty = parseFloat(draft);
      if (!Number.isNaN(qty) && qty !== ing.currentQty) {
        dispatch({ type: 'BULK_UPDATE_QUANTITIES', ingredients: [{ id, qty }], products: [], today });
      }
      setIngredientDrafts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
    setDetailId(id);
  }

  const nothingToCount = state.ingredients.length === 0 && state.products.length === 0;
  const nothingFound = !nothingToCount && filteredIngredients.length === 0 && filteredProducts.length === 0;

  return (
    <div>
      <div className="screen-header">
        <h1 className="screen-title">מצרכים</h1>
        <button type="button" className="btn btn-icon btn-primary" onClick={() => setAdding(true)} aria-label="הוסף מצרך">
          +
        </button>
      </div>
      <p className="muted" style={{ marginBottom: 'var(--space-4)' }}>
        עברו על הרשימה, הזינו את הכמות שנספרה בפועל, ושמרו הכל בבת אחת בסוף.
      </p>

      <SearchInput value={query} onChange={setQuery} placeholder="חיפוש מצרך או מוצר..." />

      {nothingToCount ? (
        <EmptyState text="אין עדיין מצרכים או מוצרים. הוסיפו מצרך כדי להתחיל." />
      ) : nothingFound ? (
        <EmptyState text="לא נמצאו פריטים." />
      ) : (
        <>
          {filteredIngredients.length > 0 && (
            <>
              <h2 className="section-title">מצרכים</h2>
              <div className="card">
                <IngredientCountTable
                  ingredients={filteredIngredients}
                  drafts={ingredientDrafts}
                  today={today}
                  onDraftChange={(id, value) => setIngredientDrafts((prev) => ({ ...prev, [id]: value }))}
                  onOpenDetail={openDetail}
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

      {detailIngredient && <IngredientDetailSheet ingredient={detailIngredient} onClose={() => setDetailId(null)} />}
      {adding && <AddIngredientSheet onClose={() => setAdding(false)} />}
    </div>
  );
}
