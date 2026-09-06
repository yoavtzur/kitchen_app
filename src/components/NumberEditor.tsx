import { useState } from 'react';
import { BottomSheet } from './BottomSheet';

type Props = {
  value: number;
  label: string;
  suffix?: string;
  step?: number;
  onChange: (value: number) => void;
  className?: string;
};

export function NumberEditor({ value, label, suffix, step = 1, onChange, className }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(String(value));

  function openEditor() {
    setDraft(String(value));
    setOpen(true);
  }

  function save() {
    const parsed = parseFloat(draft);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      onChange(parsed);
    }
    setOpen(false);
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
          <div className="field">
            <label>{label}</label>
            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn btn-icon"
                onClick={() => setDraft(String(Math.max(0, parseFloat(draft || '0') - step)))}
              >
                −
              </button>
              <input
                type="number"
                inputMode="decimal"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                style={{ textAlign: 'center', flex: 1 }}
                autoFocus
              />
              <button
                type="button"
                className="btn btn-icon"
                onClick={() => setDraft(String(parseFloat(draft || '0') + step))}
              >
                +
              </button>
            </div>
          </div>
          <button type="button" className="btn btn-primary" style={{ width: '100%' }} onClick={save}>
            שמור
          </button>
        </BottomSheet>
      )}
    </>
  );
}

function formatDisplay(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}
