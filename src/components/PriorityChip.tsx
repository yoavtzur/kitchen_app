import { useState } from 'react';
import type { Priority } from '../types';
import { BottomSheet } from './BottomSheet';

const PRIORITY_LABELS: Record<Priority, string> = {
  red: 'דחוף',
  yellow: 'לא דחוף',
  green: 'לא צריך',
};

const PRIORITY_ORDER: Priority[] = ['red', 'yellow', 'green'];

/**
 * A task's priority, as one control: a small dot and its word. It sits at the far edge of the row,
 * beside the assignee, never next to the done-checkbox: a thumb aiming at one used to hit the other,
 * and a wrong "done" moves stock. Tapping opens a choice rather than cycling, so a stray tap changes
 * nothing by itself.
 */
export function PriorityChip({ priority, onChange }: { priority: Priority; onChange: (next: Priority) => void }) {
  const [open, setOpen] = useState(false);
  const label = PRIORITY_LABELS[priority];
  return (
    <>
      <button
        type="button"
        className={`prio-chip ${priority}`}
        onClick={() => setOpen(true)}
        aria-label={`עדיפות: ${label}. לחצו לשינוי`}
        aria-haspopup="dialog"
      >
        <span className="prio-chip-dot" aria-hidden="true" />
        {label}
      </button>
      {open && (
        <BottomSheet title="עדיפות" onClose={() => setOpen(false)}>
          <div className="stack-gap-2" role="radiogroup" aria-label="עדיפות">
            {PRIORITY_ORDER.map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={p === priority}
                className={`btn btn-block prio-option ${p}${p === priority ? ' selected' : ''}`}
                onClick={() => {
                  if (p !== priority) onChange(p);
                  setOpen(false);
                }}
              >
                <span className="prio-chip-dot" aria-hidden="true" />
                {PRIORITY_LABELS[p]}
              </button>
            ))}
          </div>
        </BottomSheet>
      )}
    </>
  );
}
