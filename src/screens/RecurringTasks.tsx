import { useState, type FormEvent } from 'react';
import { useApp } from '../store/AppContext';
import { BottomSheet } from '../components/BottomSheet';
import { EmptyState } from '../components/EmptyState';
import { ScreenHeader } from '../components/ScreenHeader';
import { WeekdayPicker } from '../components/WeekdayPicker';
import { todayStr } from '../lib/date';
import { newId } from '../lib/ids';
import { stationOptions, UNASSIGNED_CATEGORY } from '../lib/recipeCategories';
import { ALL_WEEKDAYS, daysLabel } from '../lib/recurring';
import { useUndo } from '../lib/undo';
import type { Priority, RecurringTask } from '../types';

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: 'red', label: 'דחוף' },
  { value: 'yellow', label: 'לא דחוף' },
  { value: 'green', label: 'לא צריך' },
];

/**
 * The standing tasks — "clean the shelves" every day — in one place, so one can also be changed,
 * paused or stopped (the add-task sheet can only create them). Chef only; see `ChefRoute`.
 *
 * A rule is not a task: each day it is due, an ordinary task is made from it (lib/recurring.ts).
 * So editing a rule changes *future* days, and today's already-made task is left as it is.
 */
export function RecurringTasks() {
  const { state } = useApp();
  const [editing, setEditing] = useState<RecurringTask | 'new' | null>(null);
  const rules = state.recurringTasks ?? [];

  return (
    <div>
      <ScreenHeader
        title="משימות קבועות"
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
            + משימה קבועה
          </button>
        }
      />

      {rules.length === 0 ? (
        <EmptyState text='אין עדיין משימות קבועות. הוסיפו אחת — למשל "ניקוי מדפים" כל יום — והיא תופיע ברשימה בכל בוקר.' />
      ) : (
        <div className="list-card">
          {rules.map((rule) => {
            const cook = state.cooks.find((c) => c.id === rule.assigneeId);
            const station = stationOptions(state.stations).find((o) => o.value === (rule.categoryOverride ?? UNASSIGNED_CATEGORY));
            return (
              <button key={rule.id} type="button" className="menu-row" onClick={() => setEditing(rule)}>
                <span className="menu-row-label">
                  {rule.title}
                  <span className="muted" style={{ display: 'block', fontSize: 13 }}>
                    {daysLabel(rule.days)}
                    {station ? ` · ${station.label}` : ''}
                    {cook ? ` · ${cook.name}` : ''}
                    {rule.paused ? ' · מושהית' : ''}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {editing && <RuleSheet rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function RuleSheet({ rule, onClose }: { rule: RecurringTask | null; onClose: () => void }) {
  const { state, dispatch } = useApp();
  const { deleteWithUndo } = useUndo();
  const [title, setTitle] = useState(rule?.title ?? '');
  const [days, setDays] = useState(rule?.days ?? ALL_WEEKDAYS);
  const [category, setCategory] = useState(rule?.categoryOverride ?? UNASSIGNED_CATEGORY);
  const [priority, setPriority] = useState<Priority>(rule?.priority ?? 'yellow');
  const [assigneeId, setAssigneeId] = useState(rule?.assigneeId ?? '');
  const [paused, setPaused] = useState(rule?.paused ?? false);

  const valid = title.trim().length > 0 && days.length > 0;

  function save(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    const next: RecurringTask = {
      id: rule?.id ?? newId('recurring'),
      title: title.trim(),
      days,
      categoryOverride: category,
      priority,
      assigneeId: assigneeId || undefined,
      paused: paused || undefined,
    };
    dispatch(rule ? { type: 'UPDATE_RECURRING_TASK', rule: next } : { type: 'ADD_RECURRING_TASK', rule: next, today: todayStr() });
    onClose();
  }

  function remove() {
    if (!rule) return;
    // No "are you sure?": the rule comes back with one "בטל". Tasks it already made stay.
    deleteWithUndo({ type: 'DELETE_RECURRING_TASK', id: rule.id }, `"${rule.title}" נמחקה`);
    onClose();
  }

  return (
    <BottomSheet title={rule ? 'עריכת משימה קבועה' : 'משימה קבועה חדשה'} onClose={onClose}>
      <form onSubmit={save} className="stack-gap-3">
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="rec-title">כותרת</label>
          <input
            id="rec-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="לדוגמה: ניקוי מדפים"
            autoFocus={!rule}
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>ימים</label>
          <WeekdayPicker value={days} onChange={setDays} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="rec-station">עמדה</label>
          <select id="rec-station" value={category} onChange={(e) => setCategory(e.target.value)}>
            {stationOptions(state.stations).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="rec-priority">רמת דחיפות</label>
          <select id="rec-priority" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            {PRIORITIES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="rec-assignee">שיוך לטבח</label>
          <select id="rec-assignee" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">— ללא —</option>
            {state.cooks.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        {rule && (
          <label className="row" style={{ gap: 8, justifyContent: 'flex-start' }}>
            <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} style={{ width: 'auto' }} />
            השהיה — לא תופיע עד שתופעל מחדש
          </label>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={!valid}>
          שמירה
        </button>
        {rule && (
          <button type="button" className="btn btn-block" style={{ color: 'var(--color-red)' }} onClick={remove}>
            מחיקת המשימה הקבועה
          </button>
        )}
      </form>
    </BottomSheet>
  );
}
