import { useEffect, useState } from 'react';
import { useApp } from '../store/AppContext';
import { useAuth } from '../auth/AuthContext';
import { useToday } from '../lib/useToday';
import { useUndo } from '../lib/undo';
import { expiredItems, remainingExpiry, soonItems, type ExpiredItem } from '../lib/expiry';
import { formatDayMonth } from '../lib/date';
import { newWasteEntry } from '../lib/waste';
import { formatQty, unitLabel } from '../lib/units';
import { BottomSheet } from './BottomSheet';
import { ExpirySheet } from './ExpirySheet';
import { NumberEditor } from './NumberEditor';

type Step =
  | { kind: 'list' }
  | { kind: 'discard'; item: ExpiredItem }
  | { kind: 'extend'; item: ExpiredItem }
  // Part of a product was thrown and a newer batch is left: ask until when the rest is good.
  | { kind: 'remaining'; item: ExpiredItem; left: number; suggested: string };

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
  const soon = soonItems(state, today);

  if (items.length === 0 && soon.length === 0) return null;

  return (
    <>
      {items.length > 0 && (
        <button type="button" className="expiry-banner" onClick={() => setOpen(true)}>
          <span className="dot red" aria-hidden="true" />
          <span className="expiry-banner-text">
            {items.length === 1 ? 'פריט אחד פג תוקף' : `${items.length} פריטים פגי תוקף`} — בדקו אותם
          </span>
        </button>
      )}
      {/* Not a button: nothing to decide yet. It names what to use first, before it becomes waste. */}
      {soon.length > 0 && (
        <p className="expiry-banner soon" role="status">
          <span className="dot amber" aria-hidden="true" />
          <span className="expiry-banner-text">
            {soon.some((i) => i.daysLeft === 0) ? 'פג היום' : 'פג מחר'}: {soonNames(soon)}
          </span>
        </p>
      )}
      {open && <ExpirySheetFlow today={today} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Up to three names, then "ועוד N" — a banner that wraps to five lines pushes the task list off screen. */
function soonNames(items: { name: string }[]): string {
  const names = items.slice(0, 3).map((i) => i.name);
  const more = items.length - names.length;
  return more > 0 ? `${names.join(', ')} ועוד ${more}` : names.join(', ');
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
    // The earliest date was the old batch's. If a newer one is what remains, its date is the one
    // that is true now — ask, rather than leave good food flagged or guess silently.
    const left = Math.round((item.qty - qty) * 1000) / 1000;
    const product = item.itemType === 'product' ? state.products.find((p) => p.id === item.id) : undefined;
    const suggested = left > 0 && product ? remainingExpiry(product, item.expiresOn, today) : undefined;
    setStep(suggested ? { kind: 'remaining', item, left, suggested } : { kind: 'list' });
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

  if (step.kind === 'remaining') {
    return (
      <RemainingSheet
        item={step.item}
        left={step.left}
        suggested={step.suggested}
        today={today}
        onConfirm={(expiresOn) => {
          extend(step.item, expiresOn);
          setStep({ kind: 'list' });
        }}
        onClose={() => setStep({ kind: 'list' })}
      />
    );
  }

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

/**
 * "נשאר X — עד מתי?" after the old batch was thrown. The suggestion is the date of the last batch
 * made, one tap; "תאריך אחר" is for when the cook knows better, and closing leaves the item flagged
 * (the list above still asks about it).
 */
function RemainingSheet({
  item,
  left,
  suggested,
  today,
  onConfirm,
  onClose,
}: {
  item: ExpiredItem;
  left: number;
  suggested: string;
  today: string;
  onConfirm: (expiresOn: string | null) => void;
  onClose: () => void;
}) {
  const [picking, setPicking] = useState(false);
  if (picking) {
    return (
      <ExpirySheet
        title={`תוקף — ${item.name}`}
        today={today}
        value={suggested}
        onSave={(next) => onConfirm(next)}
        onClose={() => setPicking(false)}
      />
    );
  }
  return (
    <BottomSheet title={`נשאר — ${item.name}`} onClose={onClose}>
      <div className="stack-gap-3">
        <p>
          נשארו {formatQty(left, item.unit)}. עד מתי הם טובים?
        </p>
        <button type="button" className="btn btn-primary btn-block" onClick={() => onConfirm(suggested)}>
          עד {formatDayMonth(suggested)} (ההכנה האחרונה)
        </button>
        <button type="button" className="btn btn-block" onClick={() => setPicking(true)}>
          תאריך אחר
        </button>
        <button type="button" className="btn btn-block" onClick={onClose}>
          אחר כך
        </button>
      </div>
    </BottomSheet>
  );
}
