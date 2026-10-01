import { useEffect, useState } from 'react';
import { useApp } from '../store/AppContext';
import { useAuth } from '../auth/AuthContext';
import { useToday } from '../lib/useToday';
import { useUndo } from '../lib/undo';
import { expiredItems, type ExpiredItem } from '../lib/expiry';
import { formatDayMonth } from '../lib/date';
import { newWasteEntry } from '../lib/waste';
import { formatQty, unitLabel } from '../lib/units';
import { BottomSheet } from './BottomSheet';
import { ExpirySheet } from './ExpirySheet';
import { NumberEditor } from './NumberEditor';

type Step = { kind: 'list' } | { kind: 'discard'; item: ExpiredItem } | { kind: 'extend'; item: ExpiredItem };

/**
 * "3 פריטים פגי תוקף — בדקו אותם", at the top of the task list, and gone when nothing is past its
 * date. A prompt, not a panel: it is shown to everyone, because whoever opens the fridge is the
 * one who sees the old tub and can act on it.
 *
 * Each expired item gets exactly two answers. **זרוק** takes it out of stock and writes it to the
 * chef's waste log (the quantity defaults to all of it and can be lowered for a partial throw);
 * **האריך** moves the date, for something that is still fine. Throwing finishes with the shared
 * "בטל" toast rather than a confirmation dialog, like every other deletion in the app.
 */
export function ExpiryBanner() {
  const { state } = useApp();
  const today = useToday();
  const [open, setOpen] = useState(false);
  const items = expiredItems(state, today);

  if (items.length === 0) return null;

  return (
    <>
      <button type="button" className="expiry-banner" onClick={() => setOpen(true)}>
        <span className="dot red" aria-hidden="true" />
        <span className="expiry-banner-text">
          {items.length === 1 ? 'פריט אחד פג תוקף' : `${items.length} פריטים פגי תוקף`} — בדקו אותם
        </span>
      </button>
      {open && <ExpirySheetFlow today={today} onClose={() => setOpen(false)} />}
    </>
  );
}

function ExpirySheetFlow({ today, onClose }: { today: string; onClose: () => void }) {
  const { state, dispatch } = useApp();
  const { membership } = useAuth();
  const { showUndo } = useUndo();
  const [step, setStep] = useState<Step>({ kind: 'list' });
  // Read live, so an item vanishes from the list the moment it is thrown or extended.
  const items = expiredItems(state, today);

  function discard(item: ExpiredItem, qty: number) {
    const entry = newWasteEntry({
      today,
      itemType: item.itemType,
      itemId: item.id,
      itemName: item.name,
      unit: item.unit,
      qty,
      reason: 'expired',
      expiredOn: item.expiresOn,
      cookId: membership?.cookId ?? undefined,
    });
    dispatch({ type: 'LOG_WASTE', entry });
    showUndo(`נזרק ${formatQty(qty, item.unit)} מ"${item.name}"`, () => dispatch({ type: 'UNDO_WASTE', id: entry.id }));
    setStep({ kind: 'list' });
  }

  function extend(item: ExpiredItem, expiresOn: string | null) {
    const previous = item.expiresOn;
    dispatch({ type: 'SET_EXPIRY', itemType: item.itemType, id: item.id, expiresOn });
    showUndo(`התוקף של "${item.name}" עודכן`, () =>
      dispatch({ type: 'SET_EXPIRY', itemType: item.itemType, id: item.id, expiresOn: previous }),
    );
  }

  // Nothing left to decide: close rather than show an empty sheet.
  const allDone = items.length === 0 && step.kind === 'list';
  useEffect(() => {
    if (allDone) onClose();
  }, [allDone, onClose]);
  if (allDone) return null;

  if (step.kind === 'discard') {
    return <DiscardSheet item={step.item} onDiscard={discard} onClose={() => setStep({ kind: 'list' })} />;
  }

  return (
    <>
      <BottomSheet title="פריטים שפג תוקפם" onClose={onClose}>
        <div className="stack-gap-3">
          {items.map((item) => (
            <div key={`${item.itemType}:${item.id}`} className="card stack-gap-2">
              <div className="row-item">
                <span style={{ fontWeight: 600 }}>{item.name}</span>
                <span className="muted">{formatQty(item.qty, item.unit)}</span>
              </div>
              <p className="muted">
                {item.daysOver === 1 ? 'פג אתמול' : `פג לפני ${item.daysOver} ימים`} ({formatDayMonth(item.expiresOn)})
              </p>
              <div className="row" style={{ gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-danger"
                  style={{ flex: 1 }}
                  aria-label={`זרוק — ${item.name}`}
                  onClick={() => setStep({ kind: 'discard', item })}
                >
                  זרוק
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ flex: 1 }}
                  aria-label={`האריך — ${item.name}`}
                  onClick={() => setStep({ kind: 'extend', item })}
                >
                  האריך
                </button>
              </div>
            </div>
          ))}
        </div>
      </BottomSheet>
      {step.kind === 'extend' && (
        <ExpirySheet
          title={`האריך תוקף — ${step.item.name}`}
          today={today}
          value={today}
          onSave={(next) => extend(step.item, next)}
          onClose={() => setStep({ kind: 'list' })}
        />
      )}
    </>
  );
}

/** How much to throw: all of it unless the cook lowers it. The number is capped at what is on hand
 * — a log row for more than existed would make the chef's totals meaningless. */
function DiscardSheet({
  item,
  onDiscard,
  onClose,
}: {
  item: ExpiredItem;
  onDiscard: (item: ExpiredItem, qty: number) => void;
  onClose: () => void;
}) {
  const [qty, setQty] = useState(item.qty);
  return (
    <BottomSheet title={`זריקה — ${item.name}`} onClose={onClose}>
      <div className="stack-gap-3">
        <div className="row-item">
          <span>כמה זורקים?</span>
          <NumberEditor
            value={qty}
            label={`כמות לזריקה — ${item.name}`}
            suffix={unitLabel(item.unit)}
            onChange={(next) => setQty(Math.min(Math.max(next, 0), item.qty))}
          />
        </div>
        <p className="muted">במלאי: {formatQty(item.qty, item.unit)}. הזריקה תירשם ביומן הזריקות של השף.</p>
        <button type="button" className="btn btn-danger btn-block" disabled={qty <= 0} onClick={() => onDiscard(item, qty)}>
          זרוק
        </button>
      </div>
    </BottomSheet>
  );
}
