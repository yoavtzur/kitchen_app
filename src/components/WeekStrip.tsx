import { useMemo, useState } from 'react';
import { useApp } from '../store/AppContext';
import { weekdayValue } from '../lib/calc';
import { dayName } from '../lib/date';
import type { Ingredient } from '../types';

type Props = {
  dates: string[];
  selected: string;
  onSelect: (date: string) => void;
};

type Shortfall = { name: string; short: number; unit: Ingredient['unit'] };

/** For each date, projects cumulative usage from the first date in `dates` through that date
 * and flags an ingredient as depleted once the running total passes its current stock — an
 * early warning that a planned day can't actually be covered, not a stored fact. */
function computeDeficits(dates: string[], ingredients: Ingredient[]): Map<string, Shortfall[]> {
  const result = new Map<string, Shortfall[]>();
  for (const ing of ingredients) {
    let cumulative = 0;
    for (const date of dates) {
      cumulative += weekdayValue(ing.dailyUsage, ing.dailyUsageByWeekday, date);
      if (cumulative > ing.currentQty) {
        const list = result.get(date) ?? [];
        list.push({ name: ing.name, short: cumulative - ing.currentQty, unit: ing.unit });
        result.set(date, list);
      }
    }
  }
  return result;
}

function DeficitPopover({ items, onClose }: { items: Shortfall[]; onClose: () => void }) {
  return (
    <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
      <div className="row" style={{ marginBottom: 'var(--space-2)' }}>
        <p style={{ fontWeight: 600 }}>מצרכים שצפויים להיגמר</p>
        <button type="button" className="btn btn-icon" onClick={onClose} aria-label="סגור">
          ✕
        </button>
      </div>
      <div className="stack-gap-2">
        {items.map((item, i) => (
          <p key={i} className="muted">
            {item.name}: חוסר של {Math.round(item.short * 100) / 100} {item.unit}
          </p>
        ))}
      </div>
    </div>
  );
}

export function WeekStrip({ dates, selected, onSelect }: Props) {
  const { state } = useApp();
  const [openDay, setOpenDay] = useState<string | null>(null);

  const deficits = useMemo(() => computeDeficits(dates, state.ingredients), [dates, state.ingredients]);

  function handleSelect(date: string) {
    onSelect(date);
  }

  function toggleAlert(date: string) {
    setOpenDay((prev) => (prev === date ? null : date));
  }

  return (
    <div>
      <div className="week-strip">
        {dates.map((date) => {
          const [, m, d] = date.split('-');
          const shortfalls = deficits.get(date) ?? [];
          const alert = shortfalls.length > 0;
          return (
            <button
              key={date}
              type="button"
              className={`week-day ${date === selected ? 'active' : ''} ${alert ? 'alert' : ''}`}
              onClick={() => {
                handleSelect(date);
                if (alert) toggleAlert(date);
              }}
            >
              <div>{dayName(date)}</div>
              <div>
                {d}/{m}
              </div>
              {alert && <span className="pill red">!{shortfalls.length}</span>}
            </button>
          );
        })}
      </div>
      {openDay && deficits.get(openDay) && (
        <DeficitPopover items={deficits.get(openDay)!} onClose={() => setOpenDay(null)} />
      )}
    </div>
  );
}
