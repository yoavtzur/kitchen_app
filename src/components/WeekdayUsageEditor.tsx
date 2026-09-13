import { useId } from 'react';
import { dayShortLabel } from '../lib/date';
import type { Weekday, WeekdayUsage } from '../types';
import { DraftNumberInput } from './DraftNumberInput';

const WEEKDAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6];

type Props = {
  /** The fallback value shown as a placeholder for any weekday without its own override. */
  base: number;
  overrides?: WeekdayUsage;
  onChange: (weekday: Weekday, value: number | undefined) => void;
  label?: string;
};

/** Seven small inputs, Sunday through Saturday — a blank cell means "use the default value". */
export function WeekdayUsageEditor({ base, overrides, onChange, label }: Props) {
  const idPrefix = useId();
  return (
    <div className="weekday-usage-grid" role="group" aria-label={label}>
      {WEEKDAYS.map((weekday) => {
        const inputId = `${idPrefix}-${weekday}`;
        return (
          <div key={weekday} className="weekday-usage-cell">
            <label htmlFor={inputId}>{dayShortLabel(weekday)}</label>
            <DraftNumberInput
              id={inputId}
              placeholder={String(base)}
              value={overrides?.[weekday]}
              allowClear
              onCommit={(v) => onChange(weekday, v)}
            />
          </div>
        );
      })}
    </div>
  );
}
