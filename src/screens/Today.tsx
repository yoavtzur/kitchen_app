import { useState } from 'react';
import { useApp } from '../store/AppContext';
import { useAuth } from '../auth/AuthContext';
import { getDisplayTasks, groupByStation, sortDisplayTasks, taskProgress } from '../lib/tasks';
import { dayName } from '../lib/date';
import { useToday } from '../lib/useToday';
import { matchesQuery } from '../lib/search';
import { EmptyState } from '../components/EmptyState';
import { CookPill } from '../components/CookPill';
import { SearchInput } from '../components/SearchInput';
import { CategoryTabs } from '../components/CategoryTabs';
import { PrintButton } from '../components/PrintShare';
import { ScreenHeader } from '../components/ScreenHeader';
import { JoinRequestsBanner } from '../components/JoinRequestsBanner';
import { ExpiryBanner } from '../components/ExpiryBanner';
import { InstallHintCard } from '../components/InstallHint';
import { CalendarIcon, SearchIcon } from '../components/icons';
import { readStoredStation, resolveStation, writeStoredStation } from '../lib/todayFilter';
import { showCookCompletions, showStationHeadings, showStationTabs } from '../lib/taskRow';
import { categoryTabs, UNASSIGNED_CATEGORY, UNASSIGNED_LABEL, type CategoryFilter } from '../lib/recipeCategories';
import { TaskRow } from './tasks/TaskRow';
import { AddManualTaskSheet } from './tasks/AddManualTaskSheet';

/**
 * The app's landing screen, and the whole of its core loop.
 *
 * This replaces Home and Tasks, which were two screens showing the same list: Home was
 * read-only and every card on it merely navigated to Tasks, so a cook saw their work twice
 * before they could touch it once. What survives from Home is the restaurant name, the date and
 * the per-cook shift readout; what survives from Tasks is everything that actually does something.
 *
 * ## What sits above the list
 *
 * Only what is used on every visit: the title with search, date and print as icons, and the
 * progress bar. Search opens on demand, the date picker is the calendar icon, station tabs exist
 * only once the kitchen has stations, and adding a task is a floating button in reach of the
 * thumb. Before, the first task started below five rows of controls, around 43% down a phone.
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
  // Follows the real date (it rolls over at midnight and when the app wakes) until the cook picks
  // another day with the date picker; then their choice sticks.
  const today = useToday();
  const [picked, setPicked] = useState<string | null>(null);
  const date = picked ?? today;
  const [addingManual, setAddingManual] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  // Remembered across screens (and reloads): see lib/todayFilter.ts. `stored` is what the cook
  // picked; `category` is what is shown, which differs when that station has been deleted, and
  // when there are no stations at all (no tabs to change it back, so it must not filter).
  const [stored, setStored] = useState<CategoryFilter>(readStoredStation);
  const tabsShown = showStationTabs(state.stations);
  const category = tabsShown ? resolveStation(stored, state.stations) : 'all';
  function setCategory(next: CategoryFilter) {
    setStored(next);
    writeStoredStation(next);
  }

  const title = membership?.restaurantName?.trim() || 'ניהול מטבח';
  const searching = query.trim().length > 0;
  const searchVisible = searchOpen || searching;
  const viewingAnotherDay = picked !== null && picked !== today;

  function toggleSearch() {
    if (searchVisible) {
      setQuery('');
      setSearchOpen(false);
    } else {
      setSearchOpen(true);
    }
  }

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
  const groups = grouped ? groupByStation(openTasks, state.stations) : [];

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
      <ScreenHeader
        title={title}
        subtitle={formatToday(date)}
        actions={
          <div className="header-actions no-print">
            <button
              type="button"
              className="icon-btn"
              onClick={toggleSearch}
              aria-label="חיפוש"
              aria-expanded={searchVisible}
              aria-pressed={searchVisible}
            >
              <SearchIcon size={20} />
            </button>
            {/* A real date input laid invisibly over the icon: tapping it opens the platform's own
                picker, with no second control to keep in step. */}
            <label className="icon-btn date-btn" title="תאריך">
              <CalendarIcon size={20} />
              <input
                type="date"
                value={date}
                onChange={(e) => setPicked(e.target.value || null)}
                aria-label="תאריך"
              />
            </label>
            {/* Opens a sheet that chooses what goes on paper (stations, a cook, done or not) — or
                sends the same list to WhatsApp. */}
            <PrintButton kind="tasks" date={date} />
          </div>
        }
      />

      {/* Only ever renders for a chef in synced mode, and only while someone is waiting. */}
      <div className="no-print">
        <JoinRequestsBanner />
        <ExpiryBanner />
        {/* Last, and only on an iPhone that has not installed the app: it must never push a safety banner down. */}
        <InstallHintCard />
      </div>

      {/* The date is now behind an icon, so looking at another day has to say so out loud. */}
      {viewingAnotherDay && (
        <div className="day-banner no-print">
          <span>מוצגת רשימת {formatToday(date)}</span>
          <button type="button" onClick={() => setPicked(null)}>
            חזרה להיום
          </button>
        </div>
      )}

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

      {searchVisible && (
        <div className="no-print">
          <SearchInput value={query} onChange={setQuery} placeholder="חיפוש משימה או טבח..." autoFocus />
        </div>
      )}

      {tabsShown && !searching && (
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
        groups.map((group) => (
          <div key={group.value}>
            {showStationHeadings(groups.length, tabsShown) && <h2 className="section-title">{group.label}</h2>}
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

      {state.cooks.length > 0 && showCookCompletions(cookCompletionCounts) && (
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

      {/* Floats above the nav at the end edge, opposite .sync-badge, so the sync pill that asks a
          person to act is never underneath it. The spacer keeps the last row scrollable clear of it. */}
      <div className="fab-spacer no-print" />
      <div className="fab-bar no-print">
        <button type="button" className="btn btn-primary fab" onClick={() => setAddingManual(true)}>
          + משימה
        </button>
      </div>

      {addingManual && <AddManualTaskSheet date={date} onClose={() => setAddingManual(false)} />}
    </div>
  );
}
