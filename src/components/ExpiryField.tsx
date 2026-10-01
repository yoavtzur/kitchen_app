import { useState } from 'react';
import { useApp } from '../store/AppContext';
import { useToday } from '../lib/useToday';
import { expiryStatus } from '../lib/expiry';
import { formatDayMonth } from '../lib/date';
import type { WasteItemType } from '../types';
import { ExpirySheet } from './ExpirySheet';

/** A pill only when the date is near or past — a fine date is not worth a badge on every row. */
export function ExpiryPill({ expiresOn, today }: { expiresOn?: string; today: string }) {
  const status = expiryStatus(expiresOn, today);
  if (status === 'expired') return <span className="pill red">פג תוקף</span>;
  if (status === 'soon') return <span className="pill yellow">עומד לפוג</span>;
  return null;
}

/**
 * "תוקף" as a row inside an item's detail: the date (with a pill when it is near or past) and a
 * button that opens the picker. Shared by ingredients and prepared products, which store the same
 * `expiresOn` and take the same `SET_EXPIRY`.
 */
export function ExpiryField({
  itemType,
  id,
  name,
  expiresOn,
}: {
  itemType: WasteItemType;
  id: string;
  name: string;
  expiresOn?: string;
}) {
  const { dispatch } = useApp();
  const today = useToday();
  const [picking, setPicking] = useState(false);

  return (
    <div className="row-item">
      <span>תוקף</span>
      <span className="row" style={{ gap: 8, width: 'auto' }}>
        <ExpiryPill expiresOn={expiresOn} today={today} />
        <button type="button" className="btn" aria-label={`תוקף — ${name}`} onClick={() => setPicking(true)}>
          {expiresOn ? formatDayMonth(expiresOn) : 'הגדר'}
        </button>
      </span>
      {picking && (
        <ExpirySheet
          title={`תוקף — ${name}`}
          today={today}
          value={expiresOn}
          allowClear={Boolean(expiresOn)}
          onSave={(next) => dispatch({ type: 'SET_EXPIRY', itemType, id, expiresOn: next })}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}
