import { useNavigate } from 'react-router-dom';
import { useApp } from '../store/AppContext';
import { useAuth } from '../auth/AuthContext';
import { getDisplayTasks, type DisplayTask } from '../lib/tasks';
import { dayName, todayStr } from '../lib/date';
import { PriorityDot, PriorityPill } from '../components/PriorityDot';
import { EmptyState } from '../components/EmptyState';
import { CookPill } from '../components/CookPill';
import { stationOptions } from '../lib/recipeCategories';
import type { Priority } from '../types';

const PRIORITY_ORDER: Record<Priority, number> = { red: 0, yellow: 1, green: 2 };

function formatToday(date: string): string {
  const [, m, d] = date.split('-');
  return `יום ${dayName(date)}, ${Number(d)}/${Number(m)}`;
}

/** Read-only card for "what to cook today" — tapping it goes to the Tasks screen, where the
 * actual work (complete, adjust, dismiss) happens. */
function TaskCard({ task, recipeName }: { task: DisplayTask; recipeName?: string }) {
  const navigate = useNavigate();
  const title = recipeName ?? task.title ?? 'משימה';

  return (
    <button
      type="button"
      className={`card priority-card ${task.priority}`}
      style={{ width: '100%', textAlign: 'start', color: 'inherit', font: 'inherit', display: 'block' }}
      onClick={() => navigate('/tasks')}
    >
      <div className="row" style={{ gap: 10 }}>
        <PriorityDot priority={task.priority} />
        <span style={{ fontWeight: 600, flex: 1, minWidth: 0 }}>
          {title}
          {recipeName && !task.unitMismatch && ` — מתכון ×${task.multiplier}`}
        </span>
        <PriorityPill priority={task.priority} />
      </div>
    </button>
  );
}

export function Home() {
  const { state } = useApp();
  const { membership } = useAuth();
  const today = todayStr();
  const title = membership?.restaurantName?.trim() || 'ניהול מטבח';

  // Always read tasks through getDisplayTasks: auto tasks are computed live and are not in
  // state.tasks, so counting state.tasks alone would miss almost everything.
  const todayTasks = getDisplayTasks(today, state);
  const openTasks = todayTasks
    .filter((t) => !t.done)
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

  // Grouped by station (RecipeCategory) in the same order Tasks.tsx's own category tabs use,
  // skipping any station with nothing open right now.
  const stationGroups = stationOptions(state.stations).map((cat) => ({
    ...cat,
    tasks: openTasks.filter((t) => t.category === cat.value),
  })).filter((group) => group.tasks.length > 0);

  // Completed-today count per cook, sorted highest first — a quick "who did what" readout for
  // the whole shift, distinct from any single station's own progress.
  const cookCompletionCounts = state.cooks
    .map((cook) => ({
      cook,
      count: todayTasks.filter((t) => t.done && t.assigneeId === cook.id).length,
    }))
    .sort((a, b) => b.count - a.count);

  return (
    <div>
      <div className="home-hero">
        <span className="home-blob home-blob-a" aria-hidden="true" />
        <span className="home-blob home-blob-b" aria-hidden="true" />
        <div className="screen-header">
          <div>
            <h1 className="screen-title">{title}</h1>
            <p className="muted">{formatToday(today)} &middot; המטבח מחכה לך</p>
          </div>
          <div className="home-mascot" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 10h16v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6z" />
              <path d="M4 10a8 8 0 0 1 16 0" />
              <circle cx="12" cy="5" r="1.6" fill="#FFFFFF" stroke="none" />
            </svg>
          </div>
        </div>
      </div>

      {state.products.length === 0 ? (
        <EmptyState text="אין עדיין פריטים. הוסף מתכון ראשון במסך מתכונים והוא יופיע כאן מיד." />
      ) : openTasks.length === 0 ? (
        <EmptyState text="הכל במלאי — אין מה להכין היום." />
      ) : (
        stationGroups.map((group) => (
          <div key={group.value}>
            <h2 className="section-title">{group.label}</h2>
            <div className="card-list">
              {group.tasks.map((t) => (
                <TaskCard key={t.id} task={t} recipeName={state.recipes.find((r) => r.id === t.recipeId)?.name} />
              ))}
            </div>
          </div>
        ))
      )}

      {state.cooks.length > 0 && (
        <>
          <h2 className="section-title">משימות שהושלמו לפי טבח</h2>
          <div className="card">
            {cookCompletionCounts.map(({ cook, count }) => (
              <div key={cook.id} className="row-item">
                <CookPill cook={cook} />
                <span className="pill green">{count}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
