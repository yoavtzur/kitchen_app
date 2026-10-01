import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../store/AppContext';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { QtySheet } from '../components/QtySheet';
import { todayStr } from '../lib/date';
import { bySupplier, fullyReceived, orderedLines, stillOwed, type ReceivableLine } from '../lib/receiving';
import { formatQty, unitLabel } from '../lib/units';
import { useLongPress } from '../lib/useLongPress';
import { useUndo } from '../lib/undo';

/**
 * Receiving a delivery, built for a back door at seven in the morning: a list of what was ordered,
 * one row per item, and the common case is one tap.
 *
 *   tap         "it all arrived" — stock goes up by what is still owed, and a "בטל" appears
 *   long press  a keypad for the quantity that actually arrived, for the short or over delivery
 *
 * The long press is what keeps typing out of ~90% of deliveries: only a gap against the delivery
 * note needs a number, and it is never asked for otherwise. A short delivery leaves the rest of the
 * line open ("התקבל 3 מתוך 5") instead of closing it, so the shortfall is still on the screen
 * until it either turns up or is dealt with. Chef only — see `ChefRoute`.
 */
export function Receiving() {
  const { state } = useApp();
  const today = todayStr();
  const lines = orderedLines(state, today);
  const owed = stillOwed(lines);
  const done = fullyReceived(lines);
  const [showDone, setShowDone] = useState(false);
  const [counting, setCounting] = useState<ReceivableLine | null>(null);

  return (
    <div>
      <ScreenHeader title="קבלת סחורה" />

      {owed.length === 0 ? (
        <EmptyState
          text={
            done.length > 0
              ? 'כל מה שהוזמן התקבל ✓'
              : 'אין הזמנות שממתינות למשלוח. הזמנה שאושרה במסך ההזמנות תופיע כאן.'
          }
        />
      ) : (
        <>
          <p className="muted" style={{ marginBottom: 'var(--space-3)' }}>
            לחיצה — התקבל במלואו. לחיצה ארוכה — כמות אחרת.
          </p>
          {bySupplier(owed).map((group) => (
            <div key={group.supplier}>
              <h2 className="section-title">{group.supplier}</h2>
              <div className="stack-gap-2">
                {group.lines.map((l) => (
                  <ReceiveRow key={`${l.ingredient.id}@${l.date}`} line={l} onCount={() => setCounting(l)} />
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      {done.length > 0 && (
        <>
          <button type="button" className="done-toggle" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)}>
            התקבלו ({done.length}) {showDone ? '▴' : '▾'}
          </button>
          {showDone && (
            <div className="stack-gap-2">
              {done.map((l) => (
                <ReceiveRow key={`${l.ingredient.id}@${l.date}`} line={l} onCount={() => setCounting(l)} />
              ))}
            </div>
          )}
        </>
      )}

      <p className="muted" style={{ marginTop: 'var(--space-5)' }}>
        <Link to="/orders">למסך ההזמנות</Link>
      </p>

      {counting && <CountSheet line={counting} onClose={() => setCounting(null)} />}
    </div>
  );
}

function useSetReceived(line: ReceivableLine) {
  const { dispatch } = useApp();
  const { showUndo } = useUndo();
  return (receivedQty: number, message: string) => {
    const previous = line.received;
    const base = { type: 'SET_LINE_RECEIVED', ingredientId: line.ingredient.id, date: line.date } as const;
    dispatch({ ...base, receivedQty });
    showUndo(message, () => dispatch({ ...base, receivedQty: previous }));
  };
}

function ReceiveRow({ line, onCount }: { line: ReceivableLine; onCount: () => void }) {
  const set = useSetReceived(line);
  const { ingredient, ordered, received, remaining } = line;
  const finished = remaining === 0;

  const press = useLongPress({
    onTap: () =>
      finished
        ? set(0, `"${ingredient.name}" סומן כלא התקבל`)
        : set(ordered, `"${ingredient.name}" התקבל ${formatQty(remaining, ingredient.unit)}`),
    onLongPress: onCount,
  });

  return (
    <button type="button" className={`receive-row${finished ? ' received' : ''}`} {...press}>
      <span className="receive-check" aria-hidden="true">
        {finished ? '✓' : ''}
      </span>
      <span className="receive-main">
        <span className="receive-name">{ingredient.name}</span>
        <span className="muted">
          הוזמן {formatQty(ordered, ingredient.unit)}
          {received > 0 && !finished ? ` · התקבל ${formatQty(received, ingredient.unit)}` : ''}
        </span>
      </span>
      {!finished && received > 0 && <span className="pill yellow">חסר {formatQty(remaining, ingredient.unit)}</span>}
    </button>
  );
}

function CountSheet({ line, onClose }: { line: ReceivableLine; onClose: () => void }) {
  const set = useSetReceived(line);
  const { ingredient, ordered } = line;
  return (
    <QtySheet
      title={`כמה ${ingredient.name} התקבל? (הוזמן ${ordered} ${unitLabel(ingredient.unit)})`}
      initial={line.received > 0 ? line.received : ordered}
      suffix={unitLabel(ingredient.unit)}
      onSave={(qty) => set(qty, `"${ingredient.name}" — התקבלו ${formatQty(qty, ingredient.unit)}`)}
      onClose={onClose}
    />
  );
}
