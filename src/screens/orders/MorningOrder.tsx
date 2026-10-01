import { memo, useEffect, useMemo, useState } from 'react';
import { useApp, useSync } from '../../store/AppContext';
import { InfoIcon } from '../../components/icons';
import { BottomSheet } from '../../components/BottomSheet';
import { CategoryTabs } from '../../components/CategoryTabs';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { NumberEditor } from '../../components/NumberEditor';
import { SearchInput } from '../../components/SearchInput';
import { Toast } from '../../components/Toast';
import { daysOfSupply, weekdayValue } from '../../lib/calc';
import { addDays, dayOfWeek, todayStr } from '../../lib/date';
import { ALL_CATEGORIES, categoryOf, ingredientCategoryTabs, matchesCategory } from '../../lib/ingredientCategories';
import {
  buildOrderLines,
  collectCountChanges,
  effectiveCount,
  lowStockTone,
  parseQty,
  planFillToPar,
  suggestedQty,
  type CountDrafts,
} from '../../lib/orders';
import { matchesQuery } from '../../lib/search';
import { isSupabaseConfigured } from '../../lib/supabase';
import { savedMessage } from '../../lib/syncIndicator';
import { unitLabel } from '../../lib/units';
import { useTimedMessage } from '../../lib/useTimedFlag';
import type { Ingredient } from '../../types';

const UNDO_WINDOW_MS = 8000;

/** Real weekend delta (Thu/Fri/Sat) against the ingredient's own base dailyUsage — never a
 * fabricated percentage. Returns null when nothing is configured for those weekdays. */
function weekendDeltaPct(ingredient: Ingredient, today: string): number | null {
  if (ingredient.dailyUsage <= 0) return null;
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

/** What used to sit on every card: days on hand, the weekend forecast and the par level. Behind
 * an (i) now, because a chef trusting the par levels only needs it when a suggestion looks off. */
function IngredientInfoSheet({
  ingredient,
  count,
  today,
  onClose,
}: {
  ingredient: Ingredient;
  count: number;
  today: string;
  onClose: () => void;
}) {
  const { dispatch } = useApp();
  const days = daysOfSupply({ ...ingredient, currentQty: count }, today);
  const delta = weekendDeltaPct(ingredient, today);
  return (
    <BottomSheet title={ingredient.name} onClose={onClose}>
      <div className="stack-gap-3">
        <div className="row-item">
          <span className="muted">ימי מלאי</span>
          <span>{Number.isFinite(days) ? `${Math.round(days * 10) / 10} ימים` : '—'}</span>
        </div>
        <div className="row-item">
          <span className="muted">תחזית סופ״ש</span>
          {delta === null ? (
            <span className="muted">אין נתוני סופ״ש</span>
          ) : (
            <span className={`pill ${delta > 0 ? 'yellow' : 'green'}`}>
              {delta > 0 ? '+' : ''}
              {delta}% מהרגיל
            </span>
          )}
        </div>
        <div className="row-item">
          <span className="muted">מלאי מינימום</span>
          <NumberEditor
            value={ingredient.parLevel ?? 0}
            label={`מלאי מינימום — ${ingredient.name}`}
            suffix={unitLabel(ingredient.unit)}
            onChange={(parLevel) => dispatch({ type: 'SET_INGREDIENT_PAR', id: ingredient.id, parLevel })}
          />
        </div>
      </div>
    </BottomSheet>
  );
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

const MorningRow = memo(function MorningRow({
  ingredient,
  countValue,
  order,
  tone,
  onCountChange,
  onOrderCommit,
  onInfo,
}: {
  ingredient: Ingredient;
  /** What the count box shows: the typed text, or the stored count. */
  countValue: string;
  order: number;
  tone: 'red' | 'yellow' | null;
  onCountChange: (id: string, value: string) => void;
  onOrderCommit: (ingredient: Ingredient, value: number) => void;
  onInfo: (ingredient: Ingredient) => void;
}) {
  // The order box is edited locally and committed on blur/Enter, not on every keystroke: each
  // commit is an op in the sync log, and a typed "12" is one number, not "1" then "12".
  const [draft, setDraft] = useState<string | null>(null);

  function commit() {
    const qty = parseQty(draft ?? undefined);
    setDraft(null);
    if (qty !== undefined && qty !== order) onOrderCommit(ingredient, qty);
  }

  return (
    <div className="morning-row">
      <div className="morning-row-main">
        <div className="morning-row-name">
          <span className="morning-row-text">{ingredient.name}</span>
          {tone && (
            <span
              className={`dot ${tone}`}
              role="img"
              aria-label={tone === 'red' ? 'המלאי עומד להיגמר' : 'מלאי נמוך'}
            />
          )}
          <button
            type="button"
            className="info-btn"
            aria-label={`פרטים — ${ingredient.name}`}
            onClick={() => onInfo(ingredient)}
          >
            <InfoIcon size={18} />
          </button>
        </div>
        <div className="morning-row-sub">
          {categoryOf(ingredient)} · {unitLabel(ingredient.unit)}
        </div>
      </div>
      <div className="morning-cells">
        <input
          className="morning-input count"
          type="text"
          inputMode="decimal"
          aria-label={`ספירה — ${ingredient.name}`}
          value={countValue}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => onCountChange(ingredient.id, e.target.value)}
        />
        <input
          className="morning-input order"
          type="text"
          inputMode="decimal"
          aria-label={`הזמנה — ${ingredient.name}`}
          value={draft ?? fmt(order)}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      </div>
    </div>
  );
});

/**
 * The morning order, as a dense list: one line per ingredient, the order quantity at the far
 * edge. A chef cross-referencing fifty items against a delivery note needs to see eight or nine
 * of them at once — the cards this replaces showed two.
 *
 * The approve button is enabled by exactly one thing: whether the order has any lines. Counting
 * is optional, so a suggestion that is already right can be sent without touching a single field.
 */
export function MorningOrder() {
  const { state, dispatch } = useApp();
  const sync = useSync();
  const today = todayStr();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const [drafts, setDrafts] = useState<CountDrafts>({});
  const [info, setInfo] = useState<Ingredient | null>(null);
  const [confirmFill, setConfirmFill] = useState(false);
  const [undo, setUndo] = useState<{ ingredientId: string; previous: number }[] | null>(null);
  const [message, showMessage] = useTimedMessage(2500);

  const tabs = useMemo(() => ingredientCategoryTabs(state.ingredients), [state.ingredients]);
  // A tab disappears when its last ingredient does (or is recategorised); falling back to "הכל"
  // beats showing an empty list under a tab that no longer exists.
  const activeCategory = tabs.some((t) => t.value === category) ? category : ALL_CATEGORIES;

  const filtered = state.ingredients.filter(
    (ing) => matchesQuery(query, ing.name, ing.category) && matchesCategory(ing, activeCategory),
  );
  const lines = useMemo(() => buildOrderLines(state, drafts, today), [state, drafts, today]);
  const fillPlan = useMemo(() => planFillToPar(state, today), [state, today]);

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), UNDO_WINDOW_MS);
    return () => clearTimeout(t);
  }, [undo]);

  function approve() {
    const changes = collectCountChanges(state.ingredients, drafts);
    if (changes.length > 0) {
      dispatch({ type: 'BULK_UPDATE_QUANTITIES', ingredients: changes, products: [], today });
    }
    if (lines.length > 0) dispatch({ type: 'SUBMIT_ORDER', date: today, lines });
    setDrafts({});
    showMessage(
      sync.online && sync.status !== 'offline' ? 'הספירה וההזמנה נשמרו ✓' : savedMessage(sync, isSupabaseConfigured),
    );
  }

  function fillToPar() {
    setConfirmFill(false);
    for (const { ingredientId } of fillPlan) {
      dispatch({ type: 'SET_ORDER_LINE_QTY', ingredientId, date: today, qtyOverride: null });
    }
    setUndo(fillPlan);
  }

  function undoFill() {
    if (!undo) return;
    for (const { ingredientId, previous } of undo) {
      dispatch({ type: 'SET_ORDER_LINE_QTY', ingredientId, date: today, qtyOverride: previous });
    }
    setUndo(null);
  }

  return (
    <div>
      <div className="sticky-tabs">
        <CategoryTabs tabs={tabs} value={activeCategory} onChange={setCategory} />
      </div>

      <SearchInput value={query} onChange={setQuery} placeholder="חיפוש מצרך או קטגוריה..." />

      <div className="row" style={{ marginBottom: 'var(--space-3)' }}>
        <span className="muted">
          {lines.length > 0 ? `${lines.length} פריטים בהזמנה` : 'אין מה להזמין כרגע'}
        </span>
        <button type="button" className="btn" disabled={fillPlan.length === 0} onClick={() => setConfirmFill(true)}>
          מלא לפי המינימום
        </button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState text={query ? 'לא נמצאו מצרכים.' : 'אין מצרכים.'} />
      ) : (
        <div className="list-card">
          <div className="morning-head" aria-hidden="true">
            <span className="morning-row-main" />
            <span className="morning-cells">
              <span>ספירה</span>
              <span>הזמנה</span>
            </span>
          </div>
          {filtered.map((ing) => {
            const count = effectiveCount(ing, drafts);
            return (
              <MorningRow
                key={ing.id}
                ingredient={ing}
                countValue={drafts[ing.id] ?? fmt(ing.currentQty)}
                order={suggestedQty(ing, state, today, drafts)}
                tone={lowStockTone(ing, count, today)}
                onCountChange={(id, value) => setDrafts((prev) => ({ ...prev, [id]: value }))}
                onOrderCommit={(i, qtyOverride) =>
                  dispatch({ type: 'SET_ORDER_LINE_QTY', ingredientId: i.id, date: today, qtyOverride })
                }
                onInfo={setInfo}
              />
            );
          })}
        </div>
      )}
      {/* Room for the fixed approve bar, so the last row can scroll clear of it. */}
      <div className="save-bar-spacer" />

      {info && (
        <IngredientInfoSheet
          ingredient={info}
          count={effectiveCount(info, drafts)}
          today={today}
          onClose={() => setInfo(null)}
        />
      )}

      {confirmFill && (
        <ConfirmDialog
          title="מילוי לפי המינימום"
          confirmLabel="חזור להצעה האוטומטית"
          onClose={() => setConfirmFill(false)}
          onConfirm={fillToPar}
        >
          <p>
            {fillPlan.length} כמויות שהוקלדו ידנית יוחלפו בהצעה האוטומטית, שמשלימה כל מצרך לרמת המינימום או
            לצריכה השבועית. אפשר לבטל מיד אחרי.
          </p>
        </ConfirmDialog>
      )}

      {undo ? (
        <Toast message="ההצעה האוטומטית הוחזרה" action={{ label: 'ביטול', onClick: undoFill }} />
      ) : (
        message && <Toast message={message} />
      )}

      <div className="count-save-bar">
        <button type="button" className="btn btn-primary btn-block" disabled={lines.length === 0} onClick={approve}>
          אשר הכל וצור הזמנה{lines.length > 0 ? ` (${lines.length})` : ''}
        </button>
      </div>
    </div>
  );
}
