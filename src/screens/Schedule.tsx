import { useMemo, useState } from 'react';
import { useApp } from '../store/AppContext';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { addDays, dayOfWeek, dayShortLabel } from '../lib/date';
import { stationOptions } from '../lib/recipeCategories';
import { shiftsOn } from '../lib/schedule';
import { useToday } from '../lib/useToday';
import { useTimedMessage } from '../lib/useTimedFlag';
import { Toast } from '../components/Toast';

const DAYS = 7;

function dayLabel(date: string, today: string): string {
  const [, m, d] = date.split('-');
  const name = date === today ? 'היום' : dayShortLabel(dayOfWeek(date));
  return `${name} ${Number(d)}/${Number(m)}`;
}

/**
 * The work schedule (chef only): for each day, who works each station. A station's tasks that day
 * then show as that cook's without anyone assigning them one by one — unless a cook was picked on
 * the task itself, which always wins (lib/schedule.ts).
 */
export function Schedule() {
  const { state, dispatch } = useApp();
  const today = useToday();
  const [weekOffset, setWeekOffset] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [message, showMessage] = useTimedMessage(2000);
  const days = useMemo(
    () => Array.from({ length: DAYS }, (_, i) => addDays(today, weekOffset * DAYS + i)),
    [today, weekOffset],
  );
  const date = picked && days.includes(picked) ? picked : days[0];
  const shifts = shiftsOn(state, date);
  const stations = stationOptions(state.stations);
  const previousDay = addDays(date, -1);
  const previousShifts = shiftsOn(state, previousDay);

  function set(stationId: string, cookId: string) {
    dispatch({ type: 'SET_STATION_COOK', date, stationId, cookId: cookId || null });
  }

  /** Yesterday's line-up onto this day: the usual week is mostly the same people at the same posts. */
  function copyPrevious() {
    for (const s of stations) {
      const from = previousShifts.get(s.value) ?? null;
      if ((shifts.get(s.value) ?? null) !== from) {
        dispatch({ type: 'SET_STATION_COOK', date, stationId: s.value, cookId: from });
      }
    }
    showMessage('הסידור הועתק ✓');
  }

  return (
    <div>
      <ScreenHeader title="סידור עבודה" />

      <div className="history-nav">
        <button type="button" className="btn btn-sm" disabled={weekOffset <= 0} onClick={() => setWeekOffset((w) => w - 1)}>
          → שבוע קודם
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setWeekOffset((w) => w + 1)}>
          שבוע הבא ←
        </button>
      </div>
      <div className="schedule-days" role="tablist" aria-label="יום">
        {days.map((d) => (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={d === date}
            className={`tab${d === date ? ' active' : ''}`}
            onClick={() => setPicked(d)}
          >
            {dayLabel(d, today)}
          </button>
        ))}
      </div>

      {state.cooks.length === 0 ? (
        <EmptyState text="אין עדיין טבחים. הוסיפו טבחים במסך הצוות." />
      ) : (
        <div className="list-card">
          {stations.map((s) => (
            <label key={s.value} className="menu-row schedule-row">
              <span className="menu-row-label">{s.label}</span>
              <select value={shifts.get(s.value) ?? ''} onChange={(e) => set(s.value, e.target.value)} aria-label={`מי עובד ב${s.label}`}>
                <option value="">לא משובץ</option>
                {state.cooks.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}

      {previousShifts.size > 0 && (
        <button type="button" className="btn btn-block" style={{ marginTop: 'var(--space-3)' }} onClick={copyPrevious}>
          העתק את הסידור מ{dayLabel(previousDay, today)}
        </button>
      )}
      <p className="muted" style={{ marginTop: 'var(--space-3)' }}>
        משימות של עמדה ישויכו אוטומטית לטבח שמשובץ בה באותו יום. טבח שנבחר ידנית על משימה גובר על הסידור.
      </p>
      {message && <Toast message={message} />}
    </div>
  );
}
