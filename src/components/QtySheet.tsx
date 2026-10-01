import { useRef, useState } from 'react';
import { BottomSheet } from './BottomSheet';

/**
 * The numeric keypad sheet, as a controlled component.
 *
 * It used to live inside `NumberEditor`, which owns its own trigger button and open state — fine
 * for "tap a number to edit it", but unusable when something else opens the keypad (a long-press
 * on a delivery row). So the keypad is here and `NumberEditor` is its first caller; whoever
 * renders this decides when it is open by rendering it at all.
 */
export function QtySheet({
  title,
  initial,
  suffix,
  onSave,
  onClose,
}: {
  title: string;
  initial: number;
  suffix?: string;
  onSave: (value: number) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(String(initial));
  // Whether any keypad press has landed yet — the first press replaces the pre-filled old value
  // instead of appending to it, so a cook never has to backspace the stale number first.
  const startedRef = useRef(false);

  function save() {
    const parsed = parseFloat(draft);
    if (!Number.isNaN(parsed) && parsed >= 0) onSave(parsed);
    onClose();
  }

  function pressDigit(d: string) {
    if (!startedRef.current) {
      startedRef.current = true;
      setDraft(d);
      return;
    }
    setDraft((prev) => prev + d);
  }

  function pressDot() {
    if (!startedRef.current) {
      startedRef.current = true;
      setDraft('0.');
      return;
    }
    setDraft((prev) => (prev.includes('.') ? prev : prev + '.'));
  }

  function pressBackspace() {
    if (!startedRef.current) {
      startedRef.current = true;
      setDraft('0');
      return;
    }
    setDraft((prev) => {
      const next = prev.slice(0, -1);
      return next === '' ? '0' : next;
    });
  }

  return (
    <BottomSheet title={title} onClose={onClose}>
      <p className="keypad-display" aria-live="polite">
        {draft}
        {suffix ? ` ${suffix}` : ''}
      </p>
      <div className="keypad-grid">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map((k) => (
          <button
            key={k}
            type="button"
            className="keypad-key"
            onClick={() => {
              if (k === '⌫') pressBackspace();
              else if (k === '.') pressDot();
              else pressDigit(k);
            }}
          >
            {k}
          </button>
        ))}
      </div>
      <div className="row" style={{ gap: 8, marginTop: 'var(--space-4)' }}>
        <button type="button" className="btn" style={{ flex: 1 }} onClick={onClose}>
          ביטול
        </button>
        <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={save}>
          אישור
        </button>
      </div>
    </BottomSheet>
  );
}
