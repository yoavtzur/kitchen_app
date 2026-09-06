import { dayShortLabel } from '../lib/date';
import type { Weekday, WeekdayUsage } from '../types';

const WEEKDAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6];

type Props = {
  /** The fallback value shown as a placeholder for any weekday without its own override. */
  base: number;
  overrides?: WeekdayUsage;
  onChange: (weekday: Weekday, value: number | undefined) => void;
};

/** Seven small inputs, Sunday through Saturday — a blank cell means "use the default value". */
export function WeekdayUsageEditor({ base, overrides, onChange }: Props) {
  return (
    <div className="weekday-usage-grid">
      {WEEKDAYS.map((weekday) => (
        <div key={weekday} className="weekday-usage-cell">
          <label>{dayShortLabel(weekday)}</label>
          <input
            type="number"
            inputMode="decimal"
            placeholder={String(base)}
            value={overrides?.[weekday] ?? ''}
            onChange={(e) => {
              const raw = e.target.value;
              onChange(weekday, raw === '' ? undefined : parseFloat(raw) || 0);
            }}
          />
        </div>
      ))}
    </div>
  );
}
