import { useState } from 'react';
import { useApp } from '../store/AppContext';
import { useAuth } from '../auth/AuthContext';
import { getDisplayTasks, groupByStation, sortDisplayTasks, taskProgress } from '../lib/tasks';
import { dayName, todayStr } from '../lib/date';
import { matchesQuery } from '../lib/search';
import { EmptyState } from '../components/EmptyState';
import { CookPill } from '../components/CookPill';
import { SearchInput } from '../components/SearchInput';
import { CategoryTabs } from '../components/CategoryTabs';
import { PrintStationButton } from '../components/PrintStationButton';
import { ScreenHeader } from '../components/ScreenHeader';
import { JoinRequestsBanner } from '../components/JoinRequestsBanner';
import { readStoredStation, resolveStation, writeStoredStation } from '../lib/todayFilter';
import { categoryTabs, UNASSIGNED_CATEGORY, UNASSIGNED_LABEL, type CategoryFilter } from '../lib/recipeCategories';
import { TaskRow } from './tasks/TaskRow';
import { AddManualTaskSheet } from './tasks/AddManualTaskSheet';

/**
 * The app's landing screen, and the whole of its core loop.
 *
 * This replaces Home and Tasks, which were two screens showing the same list: Home was
 * read-only and every card on it merely navigated to Tasks, so a cook saw their work twice
 * before they could touch it once. What survives from Home is its identity (the hero, the
 * restaurant name, the date) and the per-cook shift readout; what survives from Tasks is
 * everything that actually does something.
 *
 * ## Grouping vs. filtering
 *
 * The two are never redundant, because a heading and the active tab never name the same station
 * at the same time. The shape is lifted from `Recipes.tsx`, so this is the third use of one
 * pattern rather than a new one to learn:
 *
 *   tab "הכל"        station groups with headings — the chef surveying the kitchen
 *   a single station flat list, no heading (the active tab *is* the heading) — the cook working it
 *   searching        flat list, tabs hidden
 */
function formatToday(date: string): string {
  const [, m, d] = date.split('-');
  return `יום ${dayName(date)}, ${Number(d)}/${Number(m)}`;
}

export function Today() {
  const { state } = useApp();
  const { membership } = useAuth();
  const [date, setDate] = useState(todayStr());
  const [addingManual, setAddingManual] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [query, setQuery] = useState('');
  // Remembered across screens (and reloads): see lib/todayFilter.ts. `stored` is what the cook
  // picked; `category` is what is shown, which differs only when that station has been deleted.
  const [stored, setStored] = useState<CategoryFilter>(readStoredStation);
  const category = resolveStation(stored, state.stations);
  function setCategory(next: CategoryFilter) {
    setStored(next);
    writeStoredStation(next);
  }

  const title = membership?.restaurantName?.trim() || 'ניהול מטבח';
  const searching = query.trim().length > 0;

  // Always read through getDisplayTasks: auto tasks are computed live and are not in
  // state.tasks, so counting state.tasks alone would miss almost everything.
  const allDayTasks = getDisplayTasks(date, state);

  const visibleTasks = allDayTasks.filter((t) => {
    const recipeName = state.recipes.find((r) => r.id === t.recipeId)?.name;
    const cookName = state.cooks.find((c) => c.id === t.assigneeId)?.name;
    if (!matchesQuery(query, recipeName, t.title, cookName)) return false;
    if (!searching && category !== 'all' && t.category !== category) return false;
    return true;
  });

  // The bar reflects whatever the cook is actually looking at: with a station tab active, that
  // station's own progress is the number they want, not the kitchen's.
  const progress = taskProgress(visibleTasks);
  // A finished task leaves the working list — the cook is looking at what is still to do — and
  // waits under "הושלמו". It is still counted above and still one swipe (or tap on its box) from
  // being undone, which is how a mistaken completion is recovered once the "בטל" toast is gone.
  const openTasks = visibleTasks.filter((t) => !t.done);
  const doneTasks = sortDisplayTasks(visibleTasks.filter((t) => t.done));
  const grouped = !searching && category === 'all';

  const stationName =
    category === 'all'
      ? 'כל העמדות'
      : category === UNASSIGNED_CATEGORY
        ? UNASSIGNED_LABEL
        : (state.stations.find((s) => s.id === category)?.name ?? UNASSIGNED_LABEL);

  // Completed-today count per cook, sorted highest first — a shift readout, which is why it
  // sits *below* the task list rather than above it. Counted over the whole day, not the
  // current filter: "who did what today" is not a per-station question.
  const cookCompletionCounts = state.cooks
    .map((cook) => ({
      cook,
      count: allDayTasks.filter((t) => t.done && t.assigneeId === cook.id).length,
    }))
    .sort((a, b) => b.count - a.count);

  return (
    <div>
      <div className="home-hero">
        <span className="home-blob home-blob-a" aria-hidden="true" />
        <span className="home-blob home-blob-b" aria-hidden="true" />
        <ScreenHeader
          title={title}
          subtitle={<>{formatToday(date)} &middot; המטבח מחכה לך</>}
          actions={
            <div className="row no-print" style={{ gap: 8, width: 'auto' }}>
              <PrintStationButton label="הדפס רשימת עמדה" iconOnly />
              <div className="home-mascot" aria-hidden="true">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 10h16v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6z" />
                  <path d="M4 10a8 8 0 0 1 16 0" />
                  <circle cx="12" cy="5" r="1.6" fill="#FFFFFF" stroke="none" />
                </svg>
              </div>
            </div>
          }
        />
      </div>

      {/* Only ever renders for a chef in synced mode, and only while someone is waiting. */}
      <div className="no-print">
        <JoinRequestsBanner />
      </div>

      <div className="print-only print-banner">
        <p style={{ fontWeight: 700 }}>{title} — רשימת עמדה: {stationName}</p>
        <p>{date} &middot; הודפס ב-{new Date().toLocaleString('he-IL')}</p>
      </div>

      {/* Static rather than sticky: .bottom-nav and .sync-badge already compete for fixed
          real estate, and a third fixed element on a phone is too much. */}
      {progress.total > 0 && (
        <div className="task-progress no-print">
          <div
            className="task-progress-track"
            role="progressbar"
            aria-valuenow={progress.done}
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-label={`התקדמות משימות: ${progress.done} מתוך ${progress.total}`}
          >
            <div className="task-progress-fill" style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
          </div>
          <span className="task-progress-label muted">
            {progress.done}/{progress.total}
            {progress.urgent > 0 && ` · ${progress.urgent} דחופות`}
          </span>
        </div>
      )}

      <div className="row no-print" style={{ gap: 8, marginBottom: 'var(--space-3)' }}>
        <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={() => setAddingManual(true)}>
          + משימה
        </button>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="תאריך"
          className="date-chip"
        />
      </div>

      <SearchInput value={query} onChange={setQuery} placeholder="חיפוש משימה או טבח..." />

      {!searching && (
        <CategoryTabs tabs={categoryTabs(state.stations)} value={category} onChange={setCategory} />
      )}

      {visibleTasks.length === 0 ? (
        <EmptyState
          text={
            searching
              ? 'לא נמצאו משימות.'
              : state.products.length === 0
                ? 'אין עדיין פריטים. הוסף מתכון ראשון במסך מתכונים והוא יופיע כאן מיד.'
                : 'אין משימות ליום זה — הכל במלאי.'
          }
        />
      ) : openTasks.length === 0 ? (
        <EmptyState text="כל המשימות הושלמו ✓" />
      ) : grouped ? (
        groupByStation(openTasks, state.stations).map((group) => (
          <div key={group.value}>
            <h2 className="section-title">{group.label}</h2>
            <div className="tasks-grid">
              {group.tasks.map((t) => (
                <TaskRow key={t.id} task={t} />
              ))}
            </div>
          </div>
        ))
      ) : (
        <div className="tasks-grid">
          {sortDisplayTasks(openTasks).map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </div>
      )}

      {doneTasks.length > 0 && (
        <div className="no-print">
          <button
            type="button"
            className="done-toggle"
            aria-expanded={showDone}
            onClick={() => setShowDone((v) => !v)}
          >
            הושלמו ({doneTasks.length}) {showDone ? '▴' : '▾'}
          </button>
          {showDone && (
            <div className="tasks-grid">
              {doneTasks.map((t) => (
                <TaskRow key={t.id} task={t} />
              ))}
            </div>
          )}
        </div>
      )}

      {state.cooks.length > 0 && (
        <div className="no-print">
          <h2 className="section-title">משימות שהושלמו לפי טבח</h2>
          <div className="card">
            {cookCompletionCounts.map(({ cook, count }) => (
              <div key={cook.id} className="row-item">
                <CookPill cook={cook} />
                <span className="pill green">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {addingManual && <AddManualTaskSheet date={date} onClose={() => setAddingManual(false)} />}
    </div>
  );
}
