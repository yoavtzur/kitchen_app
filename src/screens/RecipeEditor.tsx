import { useState } from 'react';
import { useApp } from '../store/AppContext';
import { usePermissions } from '../auth/usePermissions';
import { BottomSheet } from '../components/BottomSheet';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { describeImpact, impactOfDeletingRecipe } from '../lib/integrity';
import { newId } from '../lib/ids';
import { WeekdayUsageEditor } from '../components/WeekdayUsageEditor';
import { RECIPE_CATEGORIES as CATEGORY_OPTIONS } from '../lib/recipeCategories';
import type { Ingredient, Product, ProductKind, Recipe, RecipeCategory, RecipeItem, Unit, Weekday, WeekdayUsage } from '../types';

const KIND_OPTIONS: { value: ProductKind; label: string }[] = [
  { value: 'menu', label: 'מנה בתפריט' },
  { value: 'component', label: 'מוצר ביניים' },
];

const UNIT_OPTIONS: { value: Unit; label: string }[] = [
  { value: 'kg', label: 'ק"ג' },
  { value: 'g', label: 'גרם' },
  { value: 'l', label: 'ליטר' },
  { value: 'ml', label: 'מ"ל' },
  { value: 'unit', label: "יח'" },
];

type ItemDraft = RecipeItem & { key: string; newIngredientName?: string };

// Sentinel refId marking a recipe item that names a not-yet-created ingredient — resolved
// into a real ingredient (via ADD_INGREDIENT) at save time.
const NEW_INGREDIENT_ID = '__new__';

/**
 * Picking a recipe item is one tap here instead of "add a default row, then open its select
 * to change it" — "+ מצרך חדש" always leads so creating a new ingredient never requires
 * scrolling past the existing list.
 */
function IngredientPickerSheet({
  ingredients,
  products,
  onSelect,
  onClose,
}: {
  ingredients: Ingredient[];
  products: Product[];
  onSelect: (refType: RecipeItem['refType'], refId: string) => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet title="בחירת רכיב" onClose={onClose}>
      <div className="stack-gap-2">
        <button
          type="button"
          className="btn btn-primary"
          style={{ width: '100%' }}
          onClick={() => onSelect('ingredient', NEW_INGREDIENT_ID)}
        >
          + מצרך חדש...
        </button>
        {ingredients.length > 0 && (
          <>
            <h3 className="section-title">מצרכים</h3>
            {ingredients.map((i) => (
              <button
                key={i.id}
                type="button"
                className="btn"
                style={{ width: '100%', textAlign: 'start' }}
                onClick={() => onSelect('ingredient', i.id)}
              >
                {i.name}
              </button>
            ))}
          </>
        )}
        {products.length > 0 && (
          <>
            <h3 className="section-title">מוצרים</h3>
            {products.map((p) => (
              <button
                key={p.id}
                type="button"
                className="btn"
                style={{ width: '100%', textAlign: 'start' }}
                onClick={() => onSelect('product', p.id)}
              >
                {p.name}
              </button>
            ))}
          </>
        )}
      </div>
    </BottomSheet>
  );
}

type Props = {
  recipe: Recipe | null;
  defaultCategory: RecipeCategory;
  onClose: () => void;
};

/**
 * Edits a "prep item" — the recipe and the stocked product it makes, as one thing.
 * Saving dispatches SAVE_PREP_ITEM so both halves are created and linked together, which is
 * what makes a new recipe show up on Home, Tasks, Consumption and Orders straight away.
 */
export function RecipeEditor({ recipe, defaultCategory, onClose }: Props) {
  const { state, dispatch } = useApp();
  const { canEditRecipes, canDeleteRecipes } = usePermissions();

  const linkedProduct =
    state.products.find((p) => p.id === recipe?.producesProductId) ??
    state.products.find((p) => p.recipeId === recipe?.id);

  const [name, setName] = useState(recipe?.name ?? '');
  const [category, setCategory] = useState<RecipeCategory>(recipe?.category ?? defaultCategory);
  const [kind, setKind] = useState<ProductKind>(linkedProduct?.kind ?? 'component');
  // One unit drives both the product's stock and the recipe's yield, so the two can never
  // disagree and produce a silently wrong multiplier.
  const [unit, setUnit] = useState<Unit>(linkedProduct?.unit ?? recipe?.yieldUnit ?? 'unit');
  const [yieldQty, setYieldQty] = useState(String(recipe?.yieldQty ?? 1));
  const [tracksStock, setTracksStock] = useState(recipe ? linkedProduct !== undefined : true);

  const [currentQty, setCurrentQty] = useState(String(linkedProduct?.currentQty ?? 0));
  const [dailyUsage, setDailyUsage] = useState(String(linkedProduct?.dailyUsage ?? 0));
  const [weeklyTarget, setWeeklyTarget] = useState(String(linkedProduct?.weeklyTarget ?? 0));
  const hasWeekdayUsage = Object.keys(linkedProduct?.dailyUsageByWeekday ?? {}).length > 0;
  const [showWeekdayUsage, setShowWeekdayUsage] = useState(hasWeekdayUsage);
  const [weekdayUsage, setWeekdayUsage] = useState<WeekdayUsage>(
    linkedProduct?.dailyUsageByWeekday ?? {},
  );
  const [coverageDays, setCoverageDays] = useState(
    linkedProduct?.coverageDaysOverride === undefined
      ? ''
      : String(linkedProduct.coverageDaysOverride),
  );

  const [items, setItems] = useState<ItemDraft[]>(
    (recipe?.items ?? []).map((it, i) => ({ ...it, key: `${i}-${it.refId}` })),
  );
  const [steps, setSteps] = useState<string[]>(recipe?.steps.length ? recipe.steps : ['']);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // A recipe must never consume the product it produces.
  const selectableProducts = state.products.filter((p) => p.id !== linkedProduct?.id);

  function addItemWithSelection(refType: RecipeItem['refType'], refId: string) {
    if (refType === 'ingredient' && refId === NEW_INGREDIENT_ID) {
      setItems((prev) => [
        ...prev,
        { key: `new-${Date.now()}`, refType: 'ingredient', refId: NEW_INGREDIENT_ID, qty: 0, unit: 'kg', newIngredientName: '' },
      ]);
      setPickerOpen(false);
      return;
    }
    const defaultUnit =
      refType === 'ingredient'
        ? state.ingredients.find((i) => i.id === refId)?.unit
        : state.products.find((p) => p.id === refId)?.unit;
    setItems((prev) => [
      ...prev,
      { key: `new-${Date.now()}`, refType, refId, qty: 0, unit: defaultUnit ?? 'unit' },
    ]);
    setPickerOpen(false);
  }

  function updateItem(key: string, patch: Partial<ItemDraft>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  function removeItem(key: string) {
    setItems((prev) => prev.filter((it) => it.key !== key));
  }

  function updateWeekdayUsage(weekday: Weekday, value: number | undefined) {
    setWeekdayUsage((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[weekday];
      else next[weekday] = value;
      return next;
    });
  }

  function save() {
    if (!canEditRecipes || !name.trim()) return;
    const finalItems: RecipeItem[] = [];
    for (const it of items) {
      if (it.qty <= 0) continue;
      let refId = it.refId;
      if (it.refType === 'ingredient' && refId === NEW_INGREDIENT_ID) {
        const newName = (it.newIngredientName ?? '').trim();
        if (!newName) continue;
        refId = newId('ing');
        dispatch({
          type: 'ADD_INGREDIENT',
          ingredient: {
            id: refId,
            name: newName,
            unit: it.unit,
            currentQty: 0,
            dailyUsage: 0,
            weeklyUsage: 0,
          },
        });
      }
      finalItems.push({ refType: it.refType, refId, qty: it.qty, unit: it.unit });
    }
    const finalSteps = steps.map((s) => s.trim()).filter(Boolean);

    const recipeId = recipe?.id ?? newId('recipe');
    const basePayload: Recipe = {
      id: recipeId,
      name: name.trim(),
      category,
      yieldQty: parseFloat(yieldQty) || 1,
      yieldUnit: unit,
      producesProductId: undefined,
      items: finalItems,
      steps: finalSteps,
    };

    if (!tracksStock) {
      dispatch({ type: recipe ? 'UPDATE_RECIPE' : 'ADD_RECIPE', recipe: basePayload } as never);
      onClose();
      return;
    }

    const productId = linkedProduct?.id ?? newId('prod');
    const parsedCoverage = parseFloat(coverageDays);
    const product: Product = {
      id: productId,
      name: name.trim(),
      kind,
      unit,
      currentQty: parseFloat(currentQty) || 0,
      weeklyTarget: parseFloat(weeklyTarget) || 0,
      dailyUsage: parseFloat(dailyUsage) || 0,
      dailyUsageByWeekday:
        showWeekdayUsage && Object.keys(weekdayUsage).length > 0 ? weekdayUsage : undefined,
      recipeId,
      coverageDaysOverride: Number.isNaN(parsedCoverage) ? undefined : parsedCoverage,
    };

    dispatch({
      type: 'SAVE_PREP_ITEM',
      recipe: { ...basePayload, producesProductId: productId },
      product,
    });
    onClose();
  }

  function remove() {
    if (!recipe || !canDeleteRecipes) return;
    dispatch({ type: 'DELETE_RECIPE', id: recipe.id });
    onClose();
  }

  return (
    <BottomSheet title={recipe ? 'עריכת פריט' : 'הוספת פריט'} onClose={onClose}>
      <div className="field">
        <label>שם הפריט</label>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </div>

      <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
        <div className="field" style={{ flex: 1 }}>
          <label>קטגוריה</label>
          <select value={category} onChange={(e) => setCategory(e.target.value as RecipeCategory)}>
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>יחידת מידה</label>
          <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
            {UNIT_OPTIONS.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label>כמות בבאטץ&apos; אחד (תפוקת המתכון)</label>
        <input
          type="number"
          inputMode="decimal"
          value={yieldQty}
          onChange={(e) => setYieldQty(e.target.value)}
        />
      </div>

      <div className="field">
        <label>
          <input
            type="checkbox"
            checked={tracksStock}
            onChange={(e) => setTracksStock(e.target.checked)}
            style={{ width: 'auto', marginInlineEnd: 8 }}
          />
          מנוהל במלאי — מופיע במסך הראשי ומייצר משימות הכנה
        </label>
      </div>

      {tracksStock && (
        <>
          <div className="field">
            <label>סוג</label>
            <select value={kind} onChange={(e) => setKind(e.target.value as ProductKind)}>
              {KIND_OPTIONS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>
          <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
            <div className="field" style={{ flex: 1 }}>
              <label>כמות נוכחית</label>
              <input
                type="number"
                inputMode="decimal"
                value={currentQty}
                onChange={(e) => setCurrentQty(e.target.value)}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>צריכה יומית</label>
              <input
                type="number"
                inputMode="decimal"
                value={dailyUsage}
                onChange={(e) => setDailyUsage(e.target.value)}
              />
            </div>
          </div>

          <div className="field">
            <label>
              <input
                type="checkbox"
                checked={showWeekdayUsage}
                onChange={(e) => setShowWeekdayUsage(e.target.checked)}
                style={{ width: 'auto', marginInlineEnd: 8 }}
              />
              צריכה שונה בימים מסוימים (למשל שישי עמוס יותר)
            </label>
          </div>
          {showWeekdayUsage && (
            <div className="field">
              <label>צריכה יומית לפי יום (ריק = ברירת מחדל {parseFloat(dailyUsage) || 0})</label>
              <WeekdayUsageEditor
                base={parseFloat(dailyUsage) || 0}
                overrides={weekdayUsage}
                onChange={updateWeekdayUsage}
              />
            </div>
          )}

          <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
            <div className="field" style={{ flex: 1 }}>
              <label>יעד שבועי</label>
              <input
                type="number"
                inputMode="decimal"
                value={weeklyTarget}
                onChange={(e) => setWeeklyTarget(e.target.value)}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>ימי כיסוי (ריק = ברירת מחדל)</label>
              <input
                type="number"
                inputMode="decimal"
                value={coverageDays}
                placeholder={String(state.settings.defaultCoverageDays)}
                onChange={(e) => setCoverageDays(e.target.value)}
              />
            </div>
          </div>
        </>
      )}

      <h3 className="section-title">רכיבים</h3>
      <div className="stack-gap-2">
        {items.map((item) => (
          <div key={item.key}>
            <div className="row" style={{ gap: 6 }}>
              <select
                value={`${item.refType}:${item.refId}`}
                onChange={(e) => {
                  const [refType, refId] = e.target.value.split(':') as [RecipeItem['refType'], string];
                  if (refType === 'ingredient' && refId === NEW_INGREDIENT_ID) {
                    updateItem(item.key, { refType, refId, newIngredientName: '' });
                    return;
                  }
                  const defaultUnit =
                    refType === 'ingredient'
                      ? state.ingredients.find((i) => i.id === refId)?.unit
                      : state.products.find((p) => p.id === refId)?.unit;
                  updateItem(item.key, { refType, refId, unit: defaultUnit ?? item.unit });
                }}
                style={{ flex: 2, border: '1px solid var(--color-border)', borderRadius: 8, padding: '8px' }}
              >
                <option value={`ingredient:${NEW_INGREDIENT_ID}`}>+ מצרך חדש...</option>
                <optgroup label="מצרכים">
                  {state.ingredients.map((i) => (
                    <option key={i.id} value={`ingredient:${i.id}`}>
                      {i.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="מוצרים">
                  {selectableProducts.map((p) => (
                    <option key={p.id} value={`product:${p.id}`}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              </select>
              <input
                type="number"
                inputMode="decimal"
                value={item.qty || ''}
                placeholder="כמות"
                onChange={(e) => updateItem(item.key, { qty: parseFloat(e.target.value) || 0 })}
                style={{ flex: 1, border: '1px solid var(--color-border)', borderRadius: 8, padding: '8px' }}
              />
              <select
                value={item.unit}
                onChange={(e) => updateItem(item.key, { unit: e.target.value as Unit })}
                style={{ flex: 1, border: '1px solid var(--color-border)', borderRadius: 8, padding: '8px' }}
              >
                {UNIT_OPTIONS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-icon" onClick={() => removeItem(item.key)} aria-label="מחק">
                ✕
              </button>
            </div>
            {item.refType === 'ingredient' && item.refId === NEW_INGREDIENT_ID && (
              <input
                value={item.newIngredientName ?? ''}
                onChange={(e) => updateItem(item.key, { newIngredientName: e.target.value })}
                placeholder="שם המצרך החדש"
                autoFocus
                style={{
                  marginTop: 4,
                  width: '100%',
                  border: '1px solid var(--color-border)',
                  borderRadius: 8,
                  padding: '8px',
                }}
              />
            )}
          </div>
        ))}
        <button type="button" className="btn" onClick={() => setPickerOpen(true)}>
          + הוסף רכיב
        </button>
      </div>

      <h3 className="section-title">אופן ההכנה</h3>
      <div className="stack-gap-2">
        {steps.map((step, i) => (
          <div key={i} className="row" style={{ gap: 6 }}>
            <span className="muted">{i + 1}.</span>
            <textarea
              value={step}
              onChange={(e) => setSteps((prev) => prev.map((s, idx) => (idx === i ? e.target.value : s)))}
              style={{ flex: 1, minHeight: 40 }}
            />
            <button
              type="button"
              className="btn btn-icon"
              onClick={() => setSteps((prev) => prev.filter((_, idx) => idx !== i))}
              aria-label="מחק שלב"
            >
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="btn" onClick={() => setSteps((prev) => [...prev, ''])}>
          + הוסף שלב
        </button>
      </div>

      <div className="row" style={{ gap: 8, marginTop: 'var(--space-5)' }}>
        {recipe && canDeleteRecipes && (
          <button
            type="button"
            className="btn"
            onClick={() => setConfirmingDelete(true)}
            style={{ color: 'var(--color-red)' }}
          >
            מחק פריט
          </button>
        )}
        {canEditRecipes && (
          <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={save}>
            שמור
          </button>
        )}
      </div>

      {pickerOpen && (
        <IngredientPickerSheet
          ingredients={state.ingredients}
          products={selectableProducts}
          onSelect={addItemWithSelection}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {confirmingDelete && recipe && (
        <ConfirmDialog
          title={`מחיקת "${recipe.name}"`}
          confirmLabel="מחק לצמיתות"
          onClose={() => setConfirmingDelete(false)}
          onConfirm={remove}
        >
          <p>הפריט יימחק מכל האפליקציה. מה שיושפע:</p>
          {describeImpact(impactOfDeletingRecipe(recipe.id, state)).map((line, i) => (
            <p key={i} className="muted">
              • {line}
            </p>
          ))}
        </ConfirmDialog>
      )}
    </BottomSheet>
  );
}
