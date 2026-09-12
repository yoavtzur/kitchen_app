import { useState, type Dispatch } from 'react';
import { useApp } from '../store/AppContext';
import { weightedRecipeItems } from '../lib/calc';
import { getDisplayTasks, ingredientDeltasFor, type DisplayTask } from '../lib/tasks';
import { todayStr } from '../lib/date';
import { newId } from '../lib/ids';
import { formatQty } from '../lib/units';
import { PriorityDot, PriorityPill } from '../components/PriorityDot';
import { NumberEditor } from '../components/NumberEditor';
import { BottomSheet } from '../components/BottomSheet';
import { EmptyState } from '../components/EmptyState';
import { SearchInput } from '../components/SearchInput';
import { CategoryTabs } from '../components/CategoryTabs';
import { SwipeToComplete } from '../components/SwipeToComplete';
import { matchesQuery } from '../lib/search';
import { categoryTabs, stationOptions, UNASSIGNED_CATEGORY, type CategoryFilter } from '../lib/recipeCategories';
import type { Action } from '../store/reducer';
import type { AppState, Priority, Recipe, RecipeCategory, Station, Task } from '../types';

const PRIORITY_CYCLE: Priority[] = ['red', 'yellow', 'green'];

const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: 'red', label: 'דחוף' },
  { value: 'yellow', label: 'לא דחוף' },
  { value: 'green', label: 'לא צריך' },
];

function TaskDetailSheet({ task, onClose }: { task: DisplayTask; onClose: () => void }) {
  const { state, dispatch } = useApp();
  const recipe = state.recipes.find((r) => r.id === task.recipeId);
  if (!recipe) return null;
  const lines = weightedRecipeItems(recipe, task.multiplier, state);

  function setMultiplier(newMultiplier: number) {
    if (task.source === 'auto') {
      dispatch({
        type: 'SET_DAY_PLAN_ENTRY',
        date: task.date,
        entry: { productId: task.productId!, prepOverride: newMultiplier * recipe!.yieldQty },
      });
    } else {
      const original = state.tasks.find((t) => t.id === task.id);
      if (original) dispatch({ type: 'UPDATE_TASK', task: { ...original, multiplier: newMultiplier } });
    }
  }

  return (
    <BottomSheet title={`${recipe.name} — מתכון ×${task.multiplier}`} onClose={onClose}>
      <div className="field">
        <label>כפולת מתכון</label>
        <NumberEditor value={task.multiplier} label="כפולת מתכון" step={0.25} variant="stepper" onChange={setMultiplier} />
      </div>
      <table className="data-table" style={{ marginBottom: 'var(--space-3)' }}>
        <thead>
          <tr>
            <th>רכיב</th>
            <th>כמות</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => (
            <tr key={i}>
              <td>
                {line.name}
                {line.unresolvedUnit && <span className="pill yellow" style={{ marginInlineStart: 6 }}>יחידה לא תואמת</span>}
              </td>
              <td>{formatQty(line.qty, line.unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted" style={{ marginBottom: 'var(--space-2)' }}>אופן הכנה</p>
      <ol className="step-list">
        {recipe.steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
    </BottomSheet>
  );
}

/** Applies a task's completion: computes ingredient/product deltas at the given multiplier and
 * dispatches the right absolute-completion action for the task's source. Free-text tasks (no
 * recipe) pass empty deltas, same as before. */
function completeTask(
  task: DisplayTask,
  recipe: Recipe | undefined,
  multiplier: number,
  state: AppState,
  dispatch: Dispatch<Action>,
) {
  const ingredientDeltas = recipe ? ingredientDeltasFor(recipe, multiplier, state) : [];
  const producedProductId = recipe?.producesProductId;
  const producedQty = recipe && producedProductId ? recipe.yieldQty * multiplier : undefined;

  if (task.source === 'manual') {
    dispatch({
      type: 'CONFIRM_TASK_COMPLETION',
      taskId: task.id,
      ingredientDeltas,
      producedProductId,
      producedQty,
    });
  } else {
    dispatch({
      type: 'CONFIRM_AUTO_TASK_COMPLETION',
      id: task.id,
      productId: task.productId!,
      date: task.date,
      ingredientDeltas,
      producedProductId,
      producedQty,
    });
  }
}

const FREE_TEXT_OPTION = '__free__';

// Sentinel station value picked from the dropdown to reveal the "new station" text field —
// same pattern as RecipeEditor.tsx's own station picker.
const NEW_STATION_ID = '__new_station__';

function AddManualTaskSheet({ date, onClose }: { date: string; onClose: () => void }) {
  const { state, dispatch } = useApp();
  const [recipeId, setRecipeId] = useState(state.recipes[0]?.id ?? FREE_TEXT_OPTION);
  const [title, setTitle] = useState('');
  const [multiplier, setMultiplier] = useState('1');
  const [priority, setPriority] = useState<Priority>('yellow');
  const [assigneeId, setAssigneeId] = useState('');
  const [category, setCategory] = useState<RecipeCategory>('general');
  const [newStationName, setNewStationName] = useState('');
  const [addingStation, setAddingStation] = useState(state.stations.length === 0);

  const isFreeText = recipeId === FREE_TEXT_OPTION;
  const selectedRecipe = state.recipes.find((r) => r.id === recipeId);

  // A free-text task keeps its own `category` state; a recipe-backed task's station lives on
  // the recipe itself (Task.category always reads from there — see lib/tasks.ts), so picking a
  // station for it dispatches UPDATE_RECIPE immediately instead of touching local state.
  function assignStation(stationId: string) {
    if (isFreeText) {
      setCategory(stationId);
    } else if (selectedRecipe) {
      dispatch({ type: 'UPDATE_RECIPE', recipe: { ...selectedRecipe, category: stationId } });
    }
  }

  // Creates (or, if a same-name station already exists, just selects) a station immediately —
  // the reducer's own case-insensitive duplicate guard is a second line of defense against two
  // devices racing to create the same station, not the primary check.
  function createStation() {
    const trimmed = newStationName.trim();
    if (!trimmed) return;
    const existing = state.stations.find((s) => s.name.trim().toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      assignStation(existing.id);
    } else {
      const station: Station = { id: newId('station'), name: trimmed, createdAt: new Date().toISOString() };
      dispatch({ type: 'ADD_STATION', station });
      assignStation(station.id);
    }
    setNewStationName('');
    setAddingStation(false);
  }

  function save() {
    if (isFreeText && !title.trim()) return;
    if (!isFreeText && !recipeId) return;
    const task: Task = {
      id: newId('task-manual'),
      date,
      recipeId: isFreeText ? undefined : recipeId,
      title: isFreeText ? title.trim() : undefined,
      categoryOverride: isFreeText ? category : undefined,
      multiplier: isFreeText ? 1 : parseFloat(multiplier) || 1,
      priority,
      assigneeId: assigneeId || undefined,
      done: false,
      source: 'manual',
    };
    dispatch({ type: 'ADD_TASK', task });
    onClose();
  }

  return (
    <BottomSheet title="הוספת משימה" onClose={onClose}>
      <div className="field">
        <label>מתכון</label>
        <select
          value={recipeId}
          onChange={(e) => {
            setRecipeId(e.target.value);
            setAddingStation(false);
            setNewStationName('');
          }}
        >
          <option value={FREE_TEXT_OPTION}>✎ משימה חופשית (בלי מתכון)</option>
          {state.recipes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      {isFreeText && (
        <div className="field">
          <label>כותרת המשימה</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="לדוגמה: לנקות מדפים" autoFocus />
        </div>
      )}
      <div className="field">
        <label>עמדה</label>
        {addingStation ? (
          <div className="row" style={{ gap: 6 }}>
            <input
              value={newStationName}
              onChange={(e) => setNewStationName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  createStation();
                }
              }}
              placeholder="עמדה חדשה (למשל: פס חם)..."
              autoFocus
              style={{ flex: 1, border: '1px solid var(--color-border)', borderRadius: 8, padding: '8px' }}
            />
            <button type="button" className="btn" onClick={createStation}>
              + הוספה
            </button>
            {state.stations.length > 0 && (
              <button
                type="button"
                className="btn btn-icon"
                onClick={() => {
                  setAddingStation(false);
                  setNewStationName('');
                }}
                aria-label="ביטול"
              >
                ✕
              </button>
            )}
          </div>
        ) : (
          <select
            value={isFreeText ? category : (selectedRecipe?.category ?? UNASSIGNED_CATEGORY)}
            onChange={(e) => {
              if (e.target.value === NEW_STATION_ID) {
                setAddingStation(true);
                return;
              }
              assignStation(e.target.value);
            }}
          >
            {stationOptions(state.stations).map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
            <option value={NEW_STATION_ID}>+ הוסף עמדה חדשה</option>
          </select>
        )}
      </div>
      {!isFreeText && (
        <div className="field">
          <label>כפולת מתכון</label>
          <input type="number" inputMode="decimal" value={multiplier} onChange={(e) => setMultiplier(e.target.value)} />
        </div>
      )}
      <div className="field">
        <label>רמת דחיפות</label>
        <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
          {PRIORITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>שיוך לטבח</label>
        <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
          <option value="">— ללא —</option>
          {state.cooks.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <button type="button" className="btn btn-primary" style={{ width: '100%' }} onClick={save}>
        הוסף משימה
      </button>
    </BottomSheet>
  );
}

function TaskRow({ task }: { task: DisplayTask }) {
  const { state, dispatch } = useApp();
  const [detailOpen, setDetailOpen] = useState(false);
  const recipe = state.recipes.find((r) => r.id === task.recipeId);

  const isAuto = task.source === 'auto';

  function markDone() {
    completeTask(task, recipe, task.multiplier, state, dispatch);
  }

  function cyclePriority() {
    const idx = PRIORITY_CYCLE.indexOf(task.priority);
    const next = PRIORITY_CYCLE[(idx + 1) % PRIORITY_CYCLE.length];
    if (isAuto) {
      dispatch({ type: 'SET_AUTO_TASK_PRIORITY', id: task.id, productId: task.productId!, date: task.date, priority: next });
    } else {
      dispatch({ type: 'SET_TASK_PRIORITY', id: task.id, priority: next });
    }
  }

  function undoDone() {
    if (isAuto) {
      dispatch({ type: 'UNDO_AUTO_TASK_COMPLETION', id: task.id });
    } else {
      dispatch({ type: 'UNDO_TASK_COMPLETION', id: task.id });
    }
  }

  function deleteTask() {
    if (isAuto) {
      dispatch({ type: 'DISMISS_AUTO_TASK', id: task.id, productId: task.productId!, date: task.date });
    } else {
      dispatch({ type: 'DELETE_TASK', id: task.id });
    }
  }

  function setAssignee(assigneeId: string) {
    if (isAuto) {
      dispatch({
        type: 'SET_AUTO_TASK_ASSIGNEE',
        id: task.id,
        productId: task.productId!,
        date: task.date,
        assigneeId: assigneeId || null,
      });
    } else {
      dispatch({ type: 'SET_TASK_ASSIGNEE', id: task.id, assigneeId: assigneeId || null });
    }
  }

  // A recipe-backed task shows its multiplier — unless the units don't line up, in which
  // case the multiplier is meaningless and the badge below explains why.
  const title = recipe
    ? task.unitMismatch
      ? recipe.name
      : `${recipe.name} — מתכון ×${task.multiplier}`
    : task.title ?? 'משימה';

  return (
    <SwipeToComplete
      onComplete={task.done ? undoDone : markDone}
      label={task.done ? '↩ בטל בוצע' : '✓ בוצע'}
    >
      <div className={`card priority-card ${task.priority}${task.done ? ' done' : ''}`}>
        <div className="row">
          <div className="row" style={{ gap: 10 }}>
            <PriorityDot priority={task.priority} onClick={cyclePriority} />
            <PriorityPill priority={task.priority} />
            <button
              type="button"
              className="task-title"
              onClick={() => recipe && setDetailOpen(true)}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                textAlign: 'start',
                fontWeight: 600,
                cursor: recipe ? 'pointer' : 'default',
              }}
            >
              {title}
            </button>
          </div>
          <button
            type="button"
            className="btn btn-icon"
            style={{ minHeight: 48, minWidth: 48 }}
            onClick={deleteTask}
            aria-label="מחק משימה"
          >
            ✕
          </button>
        </div>
        {task.unitMismatch && (
          <p className="pill red" style={{ marginTop: 'var(--space-2)' }}>
            יחידת המלאי לא תואמת ליחידת המתכון — צריך לתקן בעריכת הפריט
          </p>
        )}
        <div className="row" style={{ marginTop: 'var(--space-2)', gap: 8 }}>
          <select
            value={task.assigneeId ?? ''}
            onChange={(e) => setAssignee(e.target.value)}
            aria-label="שיוך לטבח"
            style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '6px', width: 'auto' }}
          >
            <option value="">— ללא —</option>
            {state.cooks.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        {detailOpen && <TaskDetailSheet task={task} onClose={() => setDetailOpen(false)} />}
      </div>
    </SwipeToComplete>
  );
}

export function Tasks() {
  const { state } = useApp();
  const [date, setDate] = useState(todayStr());
  const [addingManual, setAddingManual] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');

  const searching = query.trim().length > 0;

  const dayTasks = getDisplayTasks(date, state).filter((t) => {
    const recipeName = state.recipes.find((r) => r.id === t.recipeId)?.name;
    const cookName = state.cooks.find((c) => c.id === t.assigneeId)?.name;
    if (!matchesQuery(query, recipeName, t.title, cookName)) return false;
    if (!searching && category !== 'all' && t.category !== category) return false;
    return true;
  });

  return (
    <div>
      <div className="screen-header">
        <h1 className="screen-title">משימות יומיות</h1>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '8px' }} />
      </div>

      <div className="row" style={{ gap: 8, marginBottom: 'var(--space-4)' }}>
        <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={() => setAddingManual(true)}>
          + משימה
        </button>
      </div>

      <SearchInput value={query} onChange={setQuery} placeholder="חיפוש משימה או טבח..." />

      {!searching && (
        <CategoryTabs tabs={categoryTabs(state.stations)} value={category} onChange={setCategory} />
      )}

      {dayTasks.length === 0 ? (
        <EmptyState text={query ? 'לא נמצאו משימות.' : 'אין משימות ליום זה — הכל במלאי.'} />
      ) : (
        <div className="card-list">
          {dayTasks.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </div>
      )}

      {addingManual && <AddManualTaskSheet date={date} onClose={() => setAddingManual(false)} />}
    </div>
  );
}
