import { useEffect, useMemo, useState } from 'react';
import { useApp, useSync } from '../store/AppContext';
import { usePermissions } from '../auth/usePermissions';
import { useAuth } from '../auth/AuthContext';
import {
  changesIn,
  draftSize,
  loadDraft,
  movedSince,
  pruneMap,
  removeEntry,
  setEntry,
  storeDraft,
  type CountDraft,
  type DraftMap,
} from '../lib/countDraft';
import { coverageColor, daysOfSupply } from '../lib/calc';
import { CategoryTabs } from '../components/CategoryTabs';
import { EmptyState } from '../components/EmptyState';
import { ScreenHeader } from '../components/ScreenHeader';
import { Segmented } from '../components/Segmented';
import { SearchInput } from '../components/SearchInput';
import { NumberEditor } from '../components/NumberEditor';
import { BottomSheet } from '../components/BottomSheet';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { WeekdayUsageEditor } from '../components/WeekdayUsageEditor';
import { Toast } from '../components/Toast';
import { PrintButton } from '../components/PrintShare';
import { supplierNames } from '../lib/suppliers';
import { ExpiryField, ExpiryPill } from '../components/ExpiryField';
import { matchesQuery } from '../lib/search';
import {
  ALL_CATEGORIES,
  existingCategories,
  ingredientCategoryTabs,
  matchesCategory,
  normalizeCategory,
} from '../lib/ingredientCategories';
import { productStation, productStationTabs } from '../lib/stations';
import { isSupabaseConfigured } from '../lib/supabase';
import { savedMessage } from '../lib/syncIndicator';
import { useTimedFlag } from '../lib/useTimedFlag';
import { todayStr } from '../lib/date';
import { newId } from '../lib/ids';
import { canConvert, unitLabel } from '../lib/units';
import { useUndo } from '../lib/undo';
import type { Ingredient, Product, Unit, Weekday } from '../types';

const UNIT_OPTIONS: { value: Unit; label: string }[] = [
  { value: 'kg', label: 'ק"ג' },
  { value: 'g', label: 'גרם' },
  { value: 'l', label: 'ליטר' },
  { value: 'ml', label: 'מ"ל' },
  { value: 'unit', label: "יח'" },
];

type Draft = Record<string, string>;

type CountView = 'ingredients' | 'products';

const VIEW_OPTIONS: { value: CountView; label: string }[] = [
  { value: 'ingredients', label: 'מצרכים' },
  { value: 'products', label: 'מוצרים' },
];

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

/** Shown on a row whose stored stock changed after this count was typed (another device counted,
 * a delivery was received): saving would overwrite that, so it is said rather than done quietly. */
function MovedNote({ show, current, unit }: { show: boolean; current: number; unit: Unit }) {
  if (!show) return null;
  return (
    <div className="count-moved-note">
      השתנה מאז שהתחלת · עכשיו {current} {unitLabel(unit)}
    </div>
  );
}

/** The plain typed values, which is all the tables need. */
function valuesOf(map: DraftMap): Draft {
  const out: Draft = {};
  for (const [id, e] of Object.entries(map)) out[id] = e.value;
  return out;
}

type CountRow = { id: string; name: string; currentQty: number; unit: Unit; expiresOn?: string };

function CountTable({
  label,
  rows,
  drafts,
  moved,
  today,
  onDraftChange,
  onOpenDetail,
}: {
  label: string;
  rows: CountRow[];
  drafts: Draft;
  moved: Set<string>;
  today: string;
  onDraftChange: (id: string, value: string) => void;
  onOpenDetail: (id: string) => void;
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
            <td>
              <button
                type="button"
                className="count-name-btn"
                onClick={() => onOpenDetail(row.id)}
                aria-label={`תוקף — ${row.name}`}
              >
                <span>{row.name}</span>
                <ExpiryPill expiresOn={row.expiresOn} today={today} />
              </button>
              <MovedNote show={moved.has(row.id)} current={row.currentQty} unit={row.unit} />
            </td>
            <td>
              <div className="count-qty-cell">
                <NumberEditor
                  value={effectiveQty(row, drafts)}
                  label={`ספירה — ${row.name}`}
                  suffix={unitLabel(row.unit)}
                  className="count-input"
                  onChange={(value) => onDraftChange(row.id, String(value))}
                />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function toRows(items: (Ingredient | Product)[]): CountRow[] {
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    currentQty: item.currentQty,
    unit: item.unit,
    expiresOn: item.expiresOn,
  }));
}

/** A product has no detail screen of its own, so this is the whole of it: its expiry date, and for
 * a chef its minimum stock (the same field the recipe editor has). */
function ProductDetailSheet({ product, onClose }: { product: Product; onClose: () => void }) {
  const { dispatch } = useApp();
  const { isChef } = usePermissions();
  return (
    <BottomSheet title={product.name} onClose={onClose}>
      <div className="row-item">
        <span>כמות במלאי</span>
        <span className="muted">
          {product.currentQty} {unitLabel(product.unit)}
        </span>
      </div>
      {isChef && (
        <div className="row-item">
          <span>מלאי מינימום</span>
          <span className="row" style={{ gap: 6, width: 'auto' }}>
            <NumberEditor
              value={product.parLevel ?? 0}
              label={`מלאי מינימום — ${product.name}`}
              suffix={unitLabel(product.unit)}
              onChange={(parLevel) => dispatch({ type: 'SET_PRODUCT_PAR', id: product.id, parLevel })}
            />
          </span>
        </div>
      )}
      <ExpiryField itemType="product" id={product.id} name={product.name} expiresOn={product.expiresOn} />
    </BottomSheet>
  );
}

function IngredientCountTable({
  ingredients,
  drafts,
  moved,
  today,
  onDraftChange,
  onOpenDetail,
}: {
  ingredients: Ingredient[];
  drafts: Draft;
  moved: Set<string>;
  today: string;
  onDraftChange: (id: string, value: string) => void;
  /** Omitted for a cook: they count, they don't edit the ingredient database. */
  onOpenDetail?: (id: string) => void;
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
              {onOpenDetail ? (
                <button
                  type="button"
                  className="count-name-btn"
                  onClick={() => onOpenDetail(ing.id)}
                  aria-label={`פרטי ${ing.name}`}
                >
                  <span>{ing.name}</span>
                  <ExpiryPill expiresOn={ing.expiresOn} today={today} />
                </button>
              ) : (
                <span style={{ fontWeight: 600 }}>{ing.name}</span>
              )}
              <MovedNote show={moved.has(ing.id)} current={ing.currentQty} unit={ing.unit} />
            </td>
            <td>
              <div className="count-qty-cell">
                <NumberEditor
                  value={effectiveQty(ing, drafts)}
                  label={`ספירה — ${ing.name}`}
                  suffix={unitLabel(ing.unit)}
                  className="count-input"
                  onChange={(value) => onDraftChange(ing.id, String(value))}
                />
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
  const { deleteWithUndo } = useUndo();
  const [pickingUnit, setPickingUnit] = useState(false);
  // Set only for a cross-family change (e.g. weight -> count), where SET_INGREDIENT_UNIT can't
  // convert the existing numbers automatically — see the comment on that case in reducer.ts.
  const [pendingUnit, setPendingUnit] = useState<Unit | null>(null);
  const [nameDraft, setNameDraft] = useState(ingredient.name);
  const [supplierDraft, setSupplierDraft] = useState(ingredient.supplier ?? '');
  const [categoryDraft, setCategoryDraft] = useState(ingredient.category ?? '');
  const categories = existingCategories(state.ingredients);

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
    // Folds "ירקות " / "ירקות" onto the spelling already in use, so one shelf is one tab.
    const normalized = normalizeCategory(categoryDraft, categories);
    setCategoryDraft(normalized);
    const category = normalized || undefined;
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
        <input
          value={supplierDraft}
          onChange={(e) => setSupplierDraft(e.target.value)}
          onBlur={commitSupplier}
          list="ingredient-supplier-options"
        />
        <SupplierOptions />
      </div>
      <div className="field">
        <label>קטגוריה (לא חובה)</label>
        <input
          value={categoryDraft}
          onChange={(e) => setCategoryDraft(e.target.value)}
          onBlur={commitCategory}
          list="ingredient-category-options"
        />
        <CategoryOptions categories={categories} />
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
      <ExpiryField itemType="ingredient" id={ingredient.id} name={ingredient.name} expiresOn={ingredient.expiresOn} />
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
        onClick={() => {
          // No "are you sure?": the ingredient, its recipe lines and its order rows all come
          // back with one "בטל" (lib/restore.ts).
          deleteWithUndo({ type: 'DELETE_INGREDIENT', id: ingredient.id }, `"${ingredient.name}" נמחק`);
          onClose();
        }}
      >
        מחק מצרך
      </button>

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

/** Suppliers already known (cards and names on ingredients), so the same supplier is not typed
 * three ways — the name is what links an ingredient to its supplier's phone. */
function SupplierOptions() {
  const { state } = useApp();
  return (
    <datalist id="ingredient-supplier-options">
      {supplierNames(state).map((n) => (
        <option key={n} value={n} />
      ))}
    </datalist>
  );
}

function CategoryOptions({ categories }: { categories: string[] }) {
  return (
    <datalist id="ingredient-category-options">
      {categories.map((c) => (
        <option key={c} value={c} />
      ))}
    </datalist>
  );
}

function AddIngredientSheet({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useApp();
  const categories = existingCategories(state.ingredients);
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
        category: normalizeCategory(category, categories) || undefined,
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
        <input value={supplier} onChange={(e) => setSupplier(e.target.value)} list="ingredient-supplier-options" />
        <SupplierOptions />
      </div>
      <div className="field">
        <label>קטגוריה (לא חובה)</label>
        <input value={category} onChange={(e) => setCategory(e.target.value)} list="ingredient-category-options" />
        <CategoryOptions categories={categories} />
      </div>
      <button type="button" className="btn btn-primary btn-block" onClick={save}>
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
  const { isChef } = usePermissions();
  const sync = useSync();
  const { showUndo } = useUndo();
  const [view, setView] = useState<CountView>('ingredients');
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const [station, setStation] = useState('all');
  const [savedText, setSavedText] = useState('');
  const [query, setQuery] = useState('');
  const { membership } = useAuth();
  // The count in progress lives on this device until "שמור ספירה" (lib/countDraft.ts), so leaving
  // the screen mid-count no longer throws it away. Scoped to the kitchen it was typed in.
  const draftScope = membership?.restaurantId ?? 'local';
  const [draft, setDraft] = useState<CountDraft>(() => loadDraft(draftScope));
  // Told once, on arrival, that a count is waiting — not on every keystroke after.
  const [restored] = useState(() => draftSize(loadDraft(draftScope)) > 0);
  useEffect(() => storeDraft(draft), [draft]);
  const ingredientMap = useMemo(() => pruneMap(draft.ingredients, state.ingredients), [draft.ingredients, state.ingredients]);
  const productMap = useMemo(() => pruneMap(draft.products, state.products), [draft.products, state.products]);
  const ingredientDrafts = useMemo(() => valuesOf(ingredientMap), [ingredientMap]);
  const productDrafts = useMemo(() => valuesOf(productMap), [productMap]);
  const movedIngredients = useMemo(() => movedSince(ingredientMap, state.ingredients), [ingredientMap, state.ingredients]);
  const movedProducts = useMemo(() => movedSince(productMap, state.products), [productMap, state.products]);

  function setIngredientDraft(id: string, value: string) {
    const ing = state.ingredients.find((i) => i.id === id);
    if (!ing) return;
    setDraft((d) => ({ ...d, ingredients: setEntry(d.ingredients, id, value, ing.currentQty) }));
  }
  function setProductDraft(id: string, value: string) {
    const p = state.products.find((x) => x.id === id);
    if (!p) return;
    setDraft((d) => ({ ...d, products: setEntry(d.products, id, value, p.currentQty) }));
  }
  function clearDraft() {
    setDraft({ scope: draftScope, ingredients: {}, products: {} });
  }
  function discardDraft() {
    const previous = draft;
    clearDraft();
    showUndo('הספירה בוטלה', () => setDraft(previous));
  }
  const [justSaved, flagSaved] = useTimedFlag(2500);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const today = todayStr();

  const detailIngredient = state.ingredients.find((i) => i.id === detailId) ?? null;
  const [productDetailId, setProductDetailId] = useState<string | null>(null);
  const detailProduct = state.products.find((p) => p.id === productDetailId) ?? null;

  const ingredientTabs = useMemo(() => ingredientCategoryTabs(state.ingredients), [state.ingredients]);
  const stationTabs = useMemo(
    () => productStationTabs(state.products, state.recipes, state.stations),
    [state.products, state.recipes, state.stations],
  );
  // A tab vanishes with its last item; falling back to "הכל" beats an empty list under a tab
  // that no longer exists.
  const activeCategory = ingredientTabs.some((t) => t.value === category) ? category : ALL_CATEGORIES;
  const activeStation = stationTabs.some((t) => t.value === station) ? station : 'all';

  const filteredIngredients = state.ingredients.filter(
    (ing) => matchesQuery(query, ing.name, ing.supplier, ing.category) && matchesCategory(ing, activeCategory),
  );
  const filteredProducts = state.products.filter(
    (p) =>
      matchesQuery(query, p.name) &&
      (activeStation === 'all' || productStation(p, state.recipes) === activeStation),
  );
  const menuProducts = filteredProducts.filter((p) => p.kind === 'menu');
  const componentProducts = filteredProducts.filter((p) => p.kind === 'component');

  const changedIngredients = useMemo(() => changesIn(ingredientMap, state.ingredients), [ingredientMap, state.ingredients]);
  const changedProducts = useMemo(() => changesIn(productMap, state.products), [productMap, state.products]);
  const changeCount = changedIngredients.length + changedProducts.length;

  function save() {
    dispatch({
      type: 'BULK_UPDATE_QUANTITIES',
      ingredients: changedIngredients,
      products: changedProducts,
      today,
    });
    clearDraft();
    // Offline, "saved" has to say *where*: in a walk-in the count is queued on this device and
    // leaves on its own when signal returns, and a cook should not have to wonder if it was lost.
    setSavedText(savedMessage(sync, isSupabaseConfigured).replace('נשמר ✓', 'הספירה נשמרה ✓'));
    flagSaved();
  }

  function openDetail(id: string) {
    const ing = state.ingredients.find((i) => i.id === id);
    const draft = ingredientDrafts[id];
    if (ing && draft !== undefined) {
      const qty = parseFloat(draft);
      if (!Number.isNaN(qty) && qty !== ing.currentQty) {
        dispatch({ type: 'BULK_UPDATE_QUANTITIES', ingredients: [{ id, qty }], products: [], today });
      }
      setDraft((d) => ({ ...d, ingredients: removeEntry(d.ingredients, id) }));
    }
    setDetailId(id);
  }

  const nothingToCount = state.ingredients.length === 0 && state.products.length === 0;
  const nothingFound = !nothingToCount && filteredIngredients.length === 0 && filteredProducts.length === 0;
  const showingIngredients = view === 'ingredients';

  return (
    <div>
      <ScreenHeader
        title="מלאי"
        actions={
          <div className="header-actions no-print">
            <PrintButton kind="stock" date={today} />
            {isChef && (
              <button type="button" className="btn btn-icon btn-primary" onClick={() => setAdding(true)} aria-label="הוסף מצרך">
                +
              </button>
            )}
          </div>
        }
      />

      {restored && changeCount > 0 && (
        <div className="day-banner">
          <span>יש ספירה שלא נשמרה ({changeCount} פריטים)</span>
          <button type="button" className="btn btn-sm" onClick={discardDraft}>
            בטל ספירה
          </button>
        </div>
      )}

      <Segmented options={VIEW_OPTIONS} value={view} onChange={setView} label="מה סופרים" />

      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder={showingIngredients ? 'חיפוש מצרך...' : 'חיפוש מוצר...'}
      />

      <div className="sticky-tabs">
        {showingIngredients ? (
          <CategoryTabs tabs={ingredientTabs} value={activeCategory} onChange={setCategory} />
        ) : (
          <CategoryTabs tabs={stationTabs} value={activeStation} onChange={setStation} />
        )}
      </div>

      {nothingToCount ? (
        <EmptyState
          text={
            isChef
              ? 'אין עדיין מצרכים או מוצרים. הוסיפו מצרך כדי להתחיל.'
              : 'אין עדיין מצרכים או מוצרים לספירה. השף יוסיף אותם.'
          }
        />
      ) : nothingFound ? (
        <EmptyState text="לא נמצאו פריטים." />
      ) : (
        <>
          {showingIngredients && filteredIngredients.length > 0 && (
            <div className="card">
              <IngredientCountTable
                ingredients={filteredIngredients}
                drafts={ingredientDrafts}
                today={today}
                moved={movedIngredients}
                onDraftChange={setIngredientDraft}
                onOpenDetail={isChef ? openDetail : undefined}
              />
            </div>
          )}
          {!showingIngredients && menuProducts.length > 0 && (
            <>
              <h2 className="section-title">מנות בתפריט</h2>
              <div className="card">
                <CountTable
                  label="מנה"
                  rows={toRows(menuProducts)}
                  drafts={productDrafts}
                  today={today}
                  onOpenDetail={setProductDetailId}
                  moved={movedProducts}
                  onDraftChange={setProductDraft}
                />
              </div>
            </>
          )}
          {!showingIngredients && componentProducts.length > 0 && (
            <>
              <h2 className="section-title">מוצרים</h2>
              <div className="card">
                <CountTable
                  label="מוצר"
                  rows={toRows(componentProducts)}
                  drafts={productDrafts}
                  today={today}
                  onOpenDetail={setProductDetailId}
                  moved={movedProducts}
                  onDraftChange={setProductDraft}
                />
              </div>
            </>
          )}
          {((showingIngredients && filteredIngredients.length === 0) ||
            (!showingIngredients && filteredProducts.length === 0)) && (
            <EmptyState text={showingIngredients ? 'אין מצרכים בתצוגה הזו.' : 'אין מוצרים בתצוגה הזו.'} />
          )}
        </>
      )}
      <div className="save-bar-spacer" />

      {justSaved && changeCount === 0 && <Toast message={savedText || 'הספירה נשמרה ✓'} />}

      {changeCount > 0 && (
        <div className="count-save-bar">
          <button type="button" className="btn btn-primary btn-block" onClick={save}>
            שמור ספירה ({changeCount})
          </button>
        </div>
      )}

      {isChef && detailIngredient && (
        <IngredientDetailSheet ingredient={detailIngredient} onClose={() => setDetailId(null)} />
      )}
      {detailProduct && <ProductDetailSheet product={detailProduct} onClose={() => setProductDetailId(null)} />}
      {isChef && adding && <AddIngredientSheet onClose={() => setAdding(false)} />}
    </div>
  );
}
