import { useMemo } from 'react';
import { dayName } from '../lib/date';
import { useApp } from '../store/AppContext';
import { hasIngredientShortfall } from '../lib/calc';

type Props = {
  dates: string[];
  selected: string;
  onSelect: (date: string) => void;
};

export function WeekStrip({ dates, selected, onSelect }: Props) {
  const { state } = useApp();

  // Per-day snapshot: does that day's own product prep need outstrip today's real stock?
  // Not a week-long depletion simulation — matches the single-day comparisons everywhere
  // else in this app (priorityFor, daysOfSupply).
  const shortfallByDate = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const date of dates) {
      map.set(date, hasIngredientShortfall(date, state));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dates, state.products, state.recipes, state.ingredients, state.dayPlans, state.specialEvents, state.settings]);

  return (
    <div className="week-strip">
      {dates.map((date) => {
        const [, m, d] = date.split('-');
        return (
          <div key={date} style={{ position: 'relative' }}>
            <button
              type="button"
              className={`week-day ${date === selected ? 'active' : ''}`}
              onClick={() => onSelect(date)}
            >
              <div>{dayName(date)}</div>
              <div>
                {d}/{m}
              </div>
            </button>
            {shortfallByDate.get(date) && (
              <span className="week-day-warning" aria-label="מלאי לא מספיק ליום זה" title="מלאי לא מספיק ליום זה" />
            )}
          </div>
        );
      })}
    </div>
  );
}
