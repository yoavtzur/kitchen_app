import { useState } from 'react';
import { useApp } from '../../store/AppContext';
import type { DisplayTask } from '../../lib/tasks';
import { PriorityChip } from '../../components/PriorityChip';
import { AlertIcon, MoreIcon } from '../../components/icons';
import { SwipeToComplete } from '../../components/SwipeToComplete';
import { completeTask } from './completeTask';
import { TaskDetailSheet } from './TaskDetailSheet';
import { QuickActionsSheet } from './QuickActionsSheet';
import { TaskMenuSheet } from './TaskMenuSheet';
import { AssigneeChip } from './AssigneeChip';
import { useUndo } from '../../lib/undo';
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
  const today = useToday();
  const [detailOpen, setDetailOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const recipe = state.recipes.find((r) => r.id === task.recipeId);

  const isAuto = task.source === 'auto';

  function markDone() {
    completeTask(task, recipe, task.multiplier, state, dispatch);
    // The completed card leaves the open list, so a slip of the thumb has to be undoable from
    // where the cook is looking — this toast now, or "הושלמו" at the bottom of the list later.
    showUndo('המשימה הושלמה', undoDone);
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

  const assignee = state.cooks.find((c) => c.id === task.assigneeId);

  return (
    <SwipeToComplete
      onComplete={task.done ? undoDone : markDone}
      label={task.done ? '↩ בטל בוצע' : '✓ בוצע'}
      // Left is quick actions on a recipe-backed task; a free-text one has no ingredients to report.
      onAction={recipe ? () => setActionsOpen(true) : undefined}
    >
      {/* Priority is the stripe on the row's edge (colour) and the chip under the title (word); a
          red outline is kept for the other thing that can be wrong, a missing ingredient. */}
      <div className={`task-row ${task.priority}${task.done ? ' done' : ''}${task.blocked ? ' critical' : ''}`}>
        <div className="task-row-main">
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
          <div className="task-row-body">
            <button
              type="button"
              className="task-title"
              onClick={() => recipe && setDetailOpen(true)}
              style={{ cursor: recipe ? 'pointer' : 'default' }}
            >
              {title}
            </button>
            <div className="task-meta">
              <PriorityChip priority={task.priority} onClick={cyclePriority} />
              {assignee && (
                <span className="task-meta-cook" style={{ color: assignee.color }}>
                  {assignee.name}
                </span>
              )}
              {task.recurring && <span>↻ קבועה</span>}
              {task.carriedFrom && !task.done && (
                <span className="task-meta-carried">{carriedLabel(daysBetween(task.carriedFrom, today))}</span>
              )}
            </div>
          </div>
          <AssigneeChip cooks={state.cooks} value={task.assigneeId} onChange={setAssignee} />
          <button
            type="button"
            className="icon-btn task-more no-print"
            onClick={() => setMenuOpen(true)}
            aria-label="עוד פעולות"
            aria-haspopup="dialog"
          >
            <MoreIcon size={20} />
          </button>
        </div>
        {task.blocked && (
          <p className="critical-note">
            <AlertIcon size={18} />
            חסר: {task.blocked.join(', ')}
          </p>
        )}
        {task.unitMismatch && (
          <p className="pill red unit-mismatch">יחידת המלאי לא תואמת ליחידת המתכון — צריך לתקן בעריכת הפריט</p>
        )}
        {menuOpen && (
          <TaskMenuSheet
            title={title}
            hasRecipe={Boolean(recipe)}
            onClose={() => setMenuOpen(false)}
            onDetails={() => {
              setMenuOpen(false);
              setDetailOpen(true);
            }}
            onQuickActions={() => {
              setMenuOpen(false);
              setActionsOpen(true);
            }}
            onDelete={deleteTask}
          />
        )}
        {detailOpen && <TaskDetailSheet task={task} onClose={() => setDetailOpen(false)} />}
        {/* Inside the row, like the sheets above: a sibling of the swipe wrapper would become a second
            child of `.tasks-grid` and add a phantom cell to the list. */}
        {actionsOpen && recipe && (
          <QuickActionsSheet task={task} recipe={recipe} onClose={() => setActionsOpen(false)} />
        )}
      </div>
    </SwipeToComplete>
  );
}
