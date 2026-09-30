import { useApp } from '../../store/AppContext';
import { weightedRecipeItems } from '../../lib/calc';
import type { DisplayTask } from '../../lib/tasks';
import { formatQty } from '../../lib/units';
import { NumberEditor } from '../../components/NumberEditor';
import { BottomSheet } from '../../components/BottomSheet';

/** The recipe behind one task: its scaled ingredient lines, its steps, and an editor for the
 * multiplier. Unchanged from when it lived inside Tasks.tsx; moved out so the merged Today
 * screen stays readable. */
export function TaskDetailSheet({ task, onClose }: { task: DisplayTask; onClose: () => void }) {
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
