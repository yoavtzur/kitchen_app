import { useRef, useState } from 'react';
import { BottomSheet } from './BottomSheet';

type Props = {
  value: number;
  label: string;
  suffix?: string;
  step?: number;
  onChange: (value: number) => void;
  className?: string;
  /** 'default' — tap to open a bottom sheet with a numeric keypad (unchanged behavior).
   * 'stepper' — no keypad: oversized − and + buttons flanking a read-only value,
   * committing each tap straight through onChange. For gloved or wet hands mid-service. */
  variant?: 'default' | 'stepper';
};

export function NumberEditor({ value, label, suffix, step = 1, onChange, className, variant = 'default' }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(String(value));
  // Whether any keypad press has landed yet in this open session — the first press replaces
  // the pre-filled old value instead of appending to it, so a cook never has to backspace the
  // stale number before typing a new one.
  const startedRef = useRef(false);

  function openEditor() {
    setDraft(String(value));
    startedRef.current = false;
    setOpen(true);
  }

  function save() {
    const parsed = parseFloat(draft);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      onChange(parsed);
    }
    setOpen(false);
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

  if (variant === 'stepper') {
    return (
      <div className={`stepper-row ${className ?? ''}`}>
        <button
          type="button"
          className="stepper-btn"
          aria-label={`${label} — הפחת`}
          onClick={() => onChange(Math.max(0, value - step))}
        >
          −
        </button>
        <span className="stepper-value">
          {formatDisplay(value)}
          {suffix ? ` ${suffix}` : ''}
        </span>
        <button
          type="button"
          className="stepper-btn"
          aria-label={`${label} — הוסף`}
          onClick={() => onChange(value + step)}
        >
          +
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className={`number-editor-value ${className ?? ''}`}
        onClick={openEditor}
      >
        {formatDisplay(value)}
        {suffix ? ` ${suffix}` : ''}
      </button>
      {open && (
        <BottomSheet title={label} onClose={() => setOpen(false)}>
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
            <button type="button" className="btn" style={{ flex: 1 }} onClick={() => setOpen(false)}>
              ביטול
            </button>
            <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={save}>
              אישור
            </button>
          </div>
        </BottomSheet>
      )}
    </>
  );
}

function formatDisplay(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}
