import { useState } from 'react';
import { QtySheet } from './QtySheet';

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
        onClick={() => setOpen(true)}
      >
        {formatDisplay(value)}
        {suffix ? ` ${suffix}` : ''}
      </button>
      {open && (
        <QtySheet title={label} initial={value} suffix={suffix} onSave={onChange} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function formatDisplay(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}
