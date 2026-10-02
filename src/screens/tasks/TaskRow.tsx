import { useState } from 'react';
import { useApp } from '../../store/AppContext';
import type { DisplayTask } from '../../lib/tasks';
import { PriorityChip } from '../../components/PriorityDot';
import { AlertIcon } from '../../components/icons';
import { SwipeToComplete } from '../../components/SwipeToComplete';
import { completeTask } from './completeTask';
import { TaskDetailSheet } from './TaskDetailSheet';
import { QuickActionsSheet } from './QuickActionsSheet';
import { useUndo } from '../../lib/undo';
import { useBatchLabel } from '../../lib/batchLabel';
import { expiryStatus } from '../../lib/expiry';
import { daysBetween } from '../../lib/date';
import { useToday } from '../../lib/useToday';
import type { Priority } from '../../types';

/** "נשארה מאתמול" / "מלפני 3 ימים" — how long a carried-over task has been waiting. */
function carriedLabel(days: number): string {
  if (days <= 1) return 'נשארה מאתמול';
  if (days === 2) return 'מלפני יומיים';
  return `מלפני ${days} ימים`;
}

const PRIORITY_CYCLE: Priority[] = ['red', 'yellow', 'green'];

export function TaskRow({ task }: { task: DisplayTask }) {
  const { state, dispatch } = useApp();
  const { showUndo } = useUndo();
  const { showBatchLabel } = useBatchLabel();
  const today = useToday();
  const [detailOpen, setDetailOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const recipe = state.recipes.find((r) => r.id === task.recipeId);

  const isAuto = task.source === 'auto';
  // Stock past its date stays counted until someone confirms it was thrown, so the card says so —
  // otherwise "enough on the shelf" reads as true while the shelf holds something that has turned.
  const producedProduct = recipe?.producesProductId
    ? state.products.find((p) => p.id === recipe.producesProductId)
    : undefined;
  const staleStock =
    !task.done && producedProduct !== undefined && producedProduct.currentQty > 0 && expiryStatus(producedProduct.expiresOn, today) === 'expired';

  function markDone() {
    const label = completeTask(task, recipe, task.multiplier, state, dispatch, today);
    // The completed card leaves the open list, so a slip of the thumb has to be undoable from
    // where the cook is looking — this toast now, or "הושלמו" at the bottom of the list later.
    // A batch with a shelf life shows the label sheet instead, which carries its own undo.
    if (label) showBatchLabel(label, undoDone);
    else showUndo('המשימה הושלמה', undoDone);
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
      // Left is quick actions on a recipe-backed task; a free-text one has no ingredients to report.
      onAction={recipe ? () => setActionsOpen(true) : undefined}
    >
      <div
        className={`card priority-card task-card-compact ${task.priority}${task.done ? ' done' : ''}${task.blocked ? ' critical' : ''}`}
      >
        <div className="row">
          <div className="row" style={{ gap: 6, flex: 1, minWidth: 0 }}>
            {/*
              The single action in this app's core loop used to be swipe-only: SwipeToComplete
              listens for touch events and nothing else, and its reveal panel is aria-hidden.
              That made "mark this done" unreachable by mouse, by keyboard and by screen reader.

              Rather than adding a new control, the decorative print-only box that already sat in
              exactly this slot is promoted to a real one. Zero net layout change, and the same
              handlers the swipe calls.

              The class is `task-check`, deliberately NOT `btn`: `@media print` carries
              `.btn { display: none !important }`, so a checkbox carrying that class would
              vanish from the printed prep list — and nobody would notice until it was on paper.
            */}
            <button
              type="button"
              className="task-check print-check"
              role="checkbox"
              aria-checked={task.done}
              aria-label={task.done ? 'בטל סימון בוצע' : 'סמן כבוצע'}
              onClick={task.done ? undoDone : markDone}
            />
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
            className="btn btn-icon no-print"
            style={{ minHeight: 48, minWidth: 48 }}
            onClick={deleteTask}
            aria-label="מחק משימה"
          >
            ✕
          </button>
        </div>
        {task.recurring && <p className="recurring-tag">↻ קבועה</p>}
        {task.carriedFrom && !task.done && (
          <p className="carried-note">{carriedLabel(daysBetween(task.carriedFrom, today))}</p>
        )}
        {task.blocked && (
          <p className="critical-note">
            <AlertIcon size={18} />
            חסר: {task.blocked.join(', ')}
          </p>
        )}
        {staleStock && (
          <p className="critical-note">
            <AlertIcon size={18} />
            יש מלאי שפג תוקפו — בדקו
          </p>
        )}
        {task.unitMismatch && (
          <p className="pill red" style={{ marginTop: 'var(--space-2)' }}>
            יחידת המלאי לא תואמת ליחידת המתכון — צריך לתקן בעריכת הפריט
          </p>
        )}
        {/* Urgency lives down here, a full row away from the done-checkbox: the two used to sit side by
            side, and a thumb aiming at one hit the other. */}
        <div className="row task-meta-row" style={{ marginTop: 'var(--space-2)', gap: 8 }}>
          <PriorityChip priority={task.priority} onClick={cyclePriority} />
          <select
            value={task.assigneeId ?? ''}
            onChange={(e) => setAssignee(e.target.value)}
            aria-label="שיוך לטבח"
            className="assignee-select"
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
        {/* Inside the card, like the detail sheet: a sibling of the swipe wrapper would become a second
            child of `.tasks-grid` and break its "lone last card spans the row" rule. */}
        {actionsOpen && recipe && (
          <QuickActionsSheet task={task} recipe={recipe} onClose={() => setActionsOpen(false)} />
        )}
      </div>
    </SwipeToComplete>
  );
}
