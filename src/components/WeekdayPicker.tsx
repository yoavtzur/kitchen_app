import { ALL_WEEKDAYS } from '../lib/recurring';
import { dayShortLabel } from '../lib/date';
import type { Weekday } from '../types';

/**
 * Seven day buttons, Sunday first, each a real toggle (`aria-pressed`) with a tall target — this is
 * tapped with a wet thumb. Controlled: the caller owns the list of chosen days.
 */
export function WeekdayPicker({ value, onChange }: { value: Weekday[]; onChange: (days: Weekday[]) => void }) {
  function toggle(day: Weekday) {
    onChange(value.includes(day) ? value.filter((d) => d !== day) : [...value, day].sort((a, b) => a - b));
  }
  return (
    <div className="weekday-picker" role="group" aria-label="ימים בשבוע">
      {ALL_WEEKDAYS.map((day) => (
        <button
          key={day}
          type="button"
          className={`weekday-chip${value.includes(day) ? ' on' : ''}`}
          aria-pressed={value.includes(day)}
          onClick={() => toggle(day)}
        >
          {dayShortLabel(day)}
        </button>
      ))}
    </div>
  );
}
