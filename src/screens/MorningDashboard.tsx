import { useMemo, useState } from 'react';
import { useApp } from '../store/AppContext';
import { useAuth } from '../auth/AuthContext';
import { coverageColor, daysOfSupply, orderQtyForIngredient, weekdayValue } from '../lib/calc';
import { addDays, dayName, dayOfWeek, todayStr } from '../lib/date';
import { formatQty, unitLabel } from '../lib/units';
import { EmptyState } from '../components/EmptyState';
import { SearchInput } from '../components/SearchInput';
import { CategoryTabs } from '../components/CategoryTabs';
import { NumberEditor } from '../components/NumberEditor';
import { matchesQuery } from '../lib/search';
import type { AppState, Ingredient } from '../types';

const NO_CATEGORY = 'ללא קטגוריה';
const ALL_CATEGORIES = 'all';

type Draft = Record<string, string>;

function effectiveQty(ingredient: Ingredient, drafts: Draft): number {
  const draft = drafts[ingredient.id];
  if (draft === undefined) return ingredient.currentQty;
  const parsed = parseFloat(draft);
  return Number.isNaN(parsed) ? ingredient.currentQty : parsed;
}

/** A pending count: only ingredients whose typed value actually differs from what's stored. */
function collectChanges(ingredients: Ingredient[], drafts: Draft): { id: string; qty: number }[] {
  return ingredients
    .filter((ing) => drafts[ing.id] !== undefined)
    .map((ing) => ({ id: ing.id, qty: parseFloat(drafts[ing.id]) }))
    .filter((u) => !Number.isNaN(u.qty) && u.qty !== ingredients.find((i) => i.id === u.id)?.currentQty);
}

/** Real weekend delta (Thu/Fri/Sat) against the ingredient's own base dailyUsage — never a
 * fabricated percentage. Returns null when nothing is configured for those weekdays. */
function weekendDeltaPct(ingredient: Ingredient): number | null {
  if (ingredient.dailyUsage <= 0) return null;
  const today = todayStr();
  const upcoming = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const weekendValues = upcoming
    .filter((d) => {
      const dow = dayOfWeek(d);
      return dow === 4 || dow === 5 || dow === 6;
    })
    .map((d) => weekdayValue(ingredient.dailyUsage, ingredient.dailyUsageByWeekday, d));
  if (weekendValues.length === 0) return null;
  const avgWeekend = weekendValues.reduce((a, b) => a + b, 0) / weekendValues.length;
  if (avgWeekend === ingredient.dailyUsage) return null;
  return Math.round(((avgWeekend - ingredient.dailyUsage) / ingredient.dailyUsage) * 100);
}

function ForecastRow({ ingredient }: { ingredient: Ingredient }) {
  const { dispatch } = useApp();
  const delta = weekendDeltaPct(ingredient);

  return (
    <div className="row-item">
      <div>
        <p className="muted" style={{ marginBottom: 4 }}>תחזית סופ״ש</p>
        {delta === null ? (
          <span className="muted">אין נתוני סופ״ש</span>
        ) : (
          <span className={`pill ${delta > 0 ? 'yellow' : 'green'}`}>
            {delta > 0 ? '+' : ''}
            {delta}% מהרגיל
          </span>
        )}
      </div>
      <div>
        <p className="muted" style={{ marginBottom: 4 }}>מלאי מינימום</p>
        <NumberEditor
          value={ingredient.parLevel ?? 0}
          label={`מלאי מינימום — ${ingredient.name}`}
          suffix={unitLabel(ingredient.unit)}
          onChange={(parLevel) => dispatch({ type: 'SET_INGREDIENT_PAR', id: ingredient.id, parLevel })}
        />
      </div>
    </div>
  );
}

function IngredientCard({
  ingredient,
  draft,
  today,
  state,
  onDraftChange,
}: {
  ingredient: Ingredient;
  draft: string | undefined;
  today: string;
  state: AppState;
  onDraftChange: (id: string, value: string) => void;
}) {
  const [showForecast, setShowForecast] = useState(false);
  const qty = effectiveQty(ingredient, { [ingredient.id]: draft ?? '' });
  const days = daysOfSupply({ ...ingredient, currentQty: qty }, today);
  const suggestedOrder = orderQtyForIngredient(ingredient.id, { ...state, ingredients: state.ingredients.map((i) => (i.id === ingredient.id ? { ...i, currentQty: qty } : i)) });

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 'var(--space-2)' }}>
        <div>
          <p style={{ fontWeight: 600 }}>{ingredient.name}</p>
          <p className="muted">{ingredient.category?.trim() || NO_CATEGORY}</p>
        </div>
        {Number.isFinite(days) ? (
          <span className={`pill ${coverageColor(days)}`}>{Math.round(days * 10) / 10} ימים</span>
        ) : (
          <span className="muted">—</span>
        )}
      </div>

      <div className="count-qty-cell">
        <input
          className="count-input"
          type="number"
          inputMode="decimal"
          aria-label={`ספירה — ${ingredient.name}`}
          value={draft ?? String(ingredient.currentQty)}
          onChange={(e) => onDraftChange(ingredient.id, e.target.value)}
        />
        <span className="muted">{unitLabel(ingredient.unit)}</span>
      </div>

      <div className="row-item">
        <span className="muted">מלאי מינימום</span>
        <span>{formatQty(ingredient.parLevel ?? 0, ingredient.unit)}</span>
      </div>
      <div className="row-item">
        <span className="muted">להזמנה מוצע</span>
        <span style={{ fontWeight: 600 }}>{formatQty(suggestedOrder, ingredient.unit)}</span>
      </div>

      <button type="button" className="btn" style={{ width: '100%', marginTop: 'var(--space-2)' }} onClick={() => setShowForecast((v) => !v)}>
        תחזית {showForecast ? '▲' : '▼'}
      </button>
      {showForecast && <ForecastRow ingredient={ingredient} />}
    </div>
  );
}

export function MorningDashboard() {
  const { state, dispatch } = useApp();
  const { membership } = useAuth();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const [drafts, setDrafts] = useState<Draft>({});
  const [submitted, setSubmitted] = useState(false);

  const today = todayStr();
  const title = membership?.restaurantName?.trim() || 'בוקר במטבח';

  const ingredientCategoryTabs = useMemo(() => {
    const categories = new Set<string>();
    for (const ing of state.ingredients) categories.add(ing.category?.trim() || NO_CATEGORY);
    const rest = [...categories].filter((c) => c !== NO_CATEGORY).sort((a, b) => a.localeCompare(b, 'he'));
    const tabs = [{ value: ALL_CATEGORIES, label: 'הכל' }, ...rest.map((c) => ({ value: c, label: c }))];
    if (categories.has(NO_CATEGORY)) tabs.push({ value: NO_CATEGORY, label: NO_CATEGORY });
    return tabs;
  }, [state.ingredients]);

  const filtered = state.ingredients.filter((ing) => {
    if (!matchesQuery(query, ing.name, ing.category)) return false;
    if (category === ALL_CATEGORIES) return true;
    return (ing.category?.trim() || NO_CATEGORY) === category;
  });

  const changedCounts = useMemo(() => collectChanges(state.ingredients, drafts), [state.ingredients, drafts]);

  function approve() {
    const lines = state.ingredients
      .map((ing) => {
        const change = changedCounts.find((c) => c.id === ing.id);
        const qty = change ? change.qty : ing.currentQty;
        const nextState = { ...state, ingredients: state.ingredients.map((i) => (i.id === ing.id ? { ...i, currentQty: qty } : i)) };
        return { ingredientId: ing.id, qty: orderQtyForIngredient(ing.id, nextState) };
      })
      .filter((l) => l.qty > 0);

    if (changedCounts.length > 0) {
      dispatch({ type: 'BULK_UPDATE_QUANTITIES', ingredients: changedCounts, products: [], today });
    }
    if (lines.length > 0) {
      dispatch({ type: 'SUBMIT_ORDER', date: today, lines });
    }
    setDrafts({});
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 2000);
  }

  return (
    <div>
      <div className="screen-header">
        <div>
          <h1 className="screen-title">{title}</h1>
          <p className="muted">
            יום {dayName(today)} &middot; קליטת סחורה · הכנות בוקר
          </p>
        </div>
      </div>

      <CategoryTabs tabs={ingredientCategoryTabs} value={category} onChange={setCategory} />

      <SearchInput value={query} onChange={setQuery} placeholder="חיפוש מצרך או קטגוריה..." variant="stepper" />

      {filtered.length === 0 ? (
        <EmptyState text={query ? 'לא נמצאו מצרכים.' : 'אין מצרכים.'} />
      ) : (
        <div className="card-list">
          {filtered.map((ing) => (
            <IngredientCard
              key={ing.id}
              ingredient={ing}
              draft={drafts[ing.id]}
              today={today}
              state={state}
              onDraftChange={(id, value) => setDrafts((prev) => ({ ...prev, [id]: value }))}
            />
          ))}
        </div>
      )}

      {submitted && (
        <p className="pill green" style={{ marginTop: 'var(--space-4)' }}>
          הספירה וההזמנה נשמרו ✓
        </p>
      )}

      <div className="count-save-bar">
        <button
          type="button"
          className="btn btn-primary"
          style={{ minHeight: 48 }}
          disabled={changedCounts.length === 0}
          onClick={approve}
        >
          אשר הכל וצור הזמנה{changedCounts.length > 0 ? ` (${changedCounts.length})` : ''}
        </button>
      </div>
    </div>
  );
}
