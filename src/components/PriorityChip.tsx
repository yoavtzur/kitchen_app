import type { Priority } from '../types';

const PRIORITY_LABELS: Record<Priority, string> = {
  red: 'דחוף',
  yellow: 'לא דחוף',
  green: 'לא צריך',
};

/**
 * A task's priority, as one control: a small dot and its word, and tapping it moves to the next
 * priority. It replaces a dot, a pill and a red border that all said the same thing; the stripe on
 * the edge of the row carries the colour, so this only has to be readable and reachable.
 */
export function PriorityChip({ priority, onClick }: { priority: Priority; onClick: () => void }) {
  const label = PRIORITY_LABELS[priority];
  return (
    <button
      type="button"
      className={`prio-chip ${priority}`}
      onClick={onClick}
      aria-label={`עדיפות: ${label}. לחצו לשינוי`}
    >
      <span className="prio-chip-dot" aria-hidden="true" />
      {label}
    </button>
  );
}
