import type { Priority } from '../types';

const LABELS: Record<Priority, string> = {
  red: 'דחוף',
  yellow: 'לא דחוף',
  green: 'לא צריך',
};

type Props = {
  priority: Priority;
  onClick?: () => void;
};

export function PriorityDot({ priority, onClick }: Props) {
  // Read-only display (no onClick, e.g. inside another interactive element like a card-button)
  // must not be a <button> — a nested button is invalid HTML and breaks accessibility trees.
  if (!onClick) {
    return <span className={`priority-dot ${priority}`} role="img" aria-label={LABELS[priority]} title={LABELS[priority]} />;
  }
  return (
    <button
      type="button"
      className={`priority-dot ${priority}`}
      onClick={onClick}
      aria-label={LABELS[priority]}
      title={LABELS[priority]}
    />
  );
}

export function PriorityPill({ priority }: { priority: Priority }) {
  return <span className={`pill ${priority}`}>{LABELS[priority]}</span>;
}

/**
 * The one control for changing a task's urgency: the dot and its word together, as a single button.
 * It used to be a bare 14px dot standing right beside the done-checkbox — close enough that a tap
 * meant for one landed on the other, and a wrong "done" moves stock. A chip with its label is both a
 * bigger target and self-explanatory, and the card places it away from the checkbox.
 */
export function PriorityChip({ priority, onClick }: Props) {
  return (
    <button
      type="button"
      className={`pill ${priority} priority-chip`}
      onClick={onClick}
      aria-label={`דחיפות: ${LABELS[priority]} — לחצו לשינוי`}
    >
      <PriorityDot priority={priority} />
      {LABELS[priority]}
    </button>
  );
}
