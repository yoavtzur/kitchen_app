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
  return (
    <button
      type="button"
      className={`priority-dot ${priority}`}
      onClick={onClick}
      aria-label={LABELS[priority]}
      title={LABELS[priority]}
      disabled={!onClick}
    />
  );
}

export function PriorityPill({ priority }: { priority: Priority }) {
  return <span className={`pill ${priority}`}>{LABELS[priority]}</span>;
}
