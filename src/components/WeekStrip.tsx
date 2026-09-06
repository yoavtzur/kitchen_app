import { dayName } from '../lib/date';

type Props = {
  dates: string[];
  selected: string;
  onSelect: (date: string) => void;
};

export function WeekStrip({ dates, selected, onSelect }: Props) {
  return (
    <div className="week-strip">
      {dates.map((date) => {
        const [, m, d] = date.split('-');
        return (
          <button
            key={date}
            type="button"
            className={`week-day ${date === selected ? 'active' : ''}`}
            onClick={() => onSelect(date)}
          >
            <div>{dayName(date)}</div>
            <div>
              {d}/{m}
            </div>
          </button>
        );
      })}
    </div>
  );
}
