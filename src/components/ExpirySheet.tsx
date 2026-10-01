import { useState } from 'react';
import { BottomSheet } from './BottomSheet';
import { extendedExpiry } from '../lib/expiry';

const QUICK_DAYS: { days: number; label: string }[] = [
  { days: 1, label: 'מחר' },
  { days: 3, label: 'עוד 3 ימים' },
  { days: 7, label: 'עוד שבוע' },
];

/**
 * Picks an item's last-good day: three one-tap lengths counted from today, or an exact date.
 *
 * Used for both setting a date for the first time and extending an expired one, so the lengths a
 * cook is offered are the same either way. The quick chips save straight away (a tap *is* the
 * decision); the exact date waits for "שמור", because a native date picker fires `change` on
 * every wheel turn on a phone.
 */
export function ExpirySheet({
  title,
  today,
  value,
  allowClear,
  onSave,
  onClose,
}: {
  title: string;
  today: string;
  value?: string;
  /** Offer "נקה תאריך" — for an item that has one and should stop being tracked. */
  allowClear?: boolean;
  /** `null` means clear the date. */
  onSave: (expiresOn: string | null) => void;
  onClose: () => void;
}) {
  const [custom, setCustom] = useState(value ?? '');

  function save(expiresOn: string | null) {
    onSave(expiresOn);
    onClose();
  }

  return (
    <BottomSheet title={title} onClose={onClose}>
      <div className="stack-gap-3">
        <div className="row" style={{ gap: 8 }}>
          {QUICK_DAYS.map(({ days, label }) => (
            <button
              key={days}
              type="button"
              className="btn"
              style={{ flex: 1 }}
              onClick={() => save(extendedExpiry(today, days))}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="field">
          <label>תאריך מדויק</label>
          <input type="date" value={custom} onChange={(e) => setCustom(e.target.value)} />
        </div>
        <button type="button" className="btn btn-primary btn-block" disabled={!custom} onClick={() => save(custom)}>
          שמור
        </button>
        {allowClear && (
          <button type="button" className="btn btn-block" onClick={() => save(null)}>
            נקה תאריך
          </button>
        )}
      </div>
    </BottomSheet>
  );
}
