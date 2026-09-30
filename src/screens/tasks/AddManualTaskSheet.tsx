import { useState } from 'react';
import { useApp } from '../../store/AppContext';
import { usePermissions } from '../../auth/usePermissions';
import { newId } from '../../lib/ids';
import { BottomSheet } from '../../components/BottomSheet';
import { stationOptions, UNASSIGNED_CATEGORY } from '../../lib/recipeCategories';
import type { Priority, RecipeCategory, Station, Task } from '../../types';

const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: 'red', label: 'דחוף' },
  { value: 'yellow', label: 'לא דחוף' },
  { value: 'green', label: 'לא צריך' },
];

const FREE_TEXT_OPTION = '__free__';

// Sentinel station value picked from the dropdown to reveal the "new station" text field —
// same pattern as RecipeEditor.tsx's own station picker.
const NEW_STATION_ID = '__new_station__';

export function AddManualTaskSheet({ date, onClose }: { date: string; onClose: () => void }) {
  const { state, dispatch } = useApp();
  const { canEditRecipes } = usePermissions();
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
  //
  // Which is exactly why the picker is disabled for a recipe-backed task without
  // `can_edit_recipes`. That dispatch is a recipe edit, and `append_ops` rejects it server-side
  // with `forbidden_action`; the sync engine flags the rejection `permanent`, drops the op, and
  // flips status to 'error' — so the cook would see the station change, then see it silently
  // revert. This path existed before the merge but was hard to reach; now that every cook lands
  // on a dispatching screen by default, it is one tap away. Free-text tasks are unaffected: they
  // only set local `categoryOverride` state and dispatch nothing.
  const canAssignStation = isFreeText || canEditRecipes;

  function assignStation(stationId: string) {
    if (isFreeText) {
      setCategory(stationId);
    } else if (selectedRecipe && canEditRecipes) {
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
        {!canAssignStation ? (
          <>
            <select value={selectedRecipe?.category ?? UNASSIGNED_CATEGORY} disabled>
              {stationOptions(state.stations).map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <p className="muted" style={{ marginTop: 4 }}>
              עמדת המשימה נקבעת במתכון עצמו, ואין לך הרשאה לערוך מתכונים.
            </p>
          </>
        ) : addingStation ? (
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
