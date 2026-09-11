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
