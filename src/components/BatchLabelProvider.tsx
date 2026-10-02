import { useMemo, useState, type ReactNode } from 'react';
import { useApp } from '../store/AppContext';
import { useAuth } from '../auth/AuthContext';
import { BatchLabelContext, type BatchLabelApi } from '../lib/batchLabel';
import type { BatchLabel } from '../lib/expiry';
import { formatDayMonth } from '../lib/date';
import { initialsOf } from '../lib/initials';
import { BottomSheet } from './BottomSheet';

/**
 * "כתבו על המכל": the dates a cook writes by hand after finishing a prep task.
 *
 * It lives above `<Outlet />`, like `UndoProvider`, for the same reason: a finished task leaves the
 * open list the moment it is marked done, so a sheet owned by its row would be unmounted with it.
 * The sheet is large on purpose — it is read from arm's length over a tray — and says who made the
 * batch (initials), which is the third thing a kitchen label carries after the name and the date.
 */
export function BatchLabelProvider({ children }: { children: ReactNode }) {
  const { state } = useApp();
  const { membership } = useAuth();
  const [current, setCurrent] = useState<{ label: BatchLabel; onUndo: () => void } | null>(null);

  const api = useMemo<BatchLabelApi>(
    () => ({ showBatchLabel: (label, onUndo) => setCurrent({ label, onUndo }) }),
    [],
  );

  const cook = state.cooks.find((c) => c.id === membership?.cookId);

  return (
    <BatchLabelContext.Provider value={api}>
      {children}
      {current && (
        <BottomSheet title="כתבו על המכל" onClose={() => setCurrent(null)}>
          <div className="stack-gap-3 batch-label">
            <p className="batch-label-name">{current.label.productName}</p>
            <div className="batch-label-dates">
              <div>
                <span className="muted">הוכן</span>
                <strong>{formatDayMonth(current.label.preparedOn)}</strong>
              </div>
              <div>
                <span className="muted">בתוקף עד</span>
                <strong className="batch-label-expiry">{formatDayMonth(current.label.expiresOn)}</strong>
              </div>
              {cook && (
                <div>
                  <span className="muted">הוכן ע״י</span>
                  <strong>{initialsOf(cook.name)}</strong>
                </div>
              )}
            </div>
            {current.label.olderExpiresOn && (
              <p className="pill yellow">
                שימו לב: במלאי יש גם הכנה קודמת שבתוקף עד {formatDayMonth(current.label.olderExpiresOn)}. האפליקציה תתריע לפי
                התאריך המוקדם.
              </p>
            )}
            <button type="button" className="btn btn-primary btn-block" onClick={() => setCurrent(null)}>
              כתבתי
            </button>
            <button
              type="button"
              className="btn btn-block"
              onClick={() => {
                current.onUndo();
                setCurrent(null);
              }}
            >
              בטל — לא הכנתי
            </button>
          </div>
        </BottomSheet>
      )}
    </BatchLabelContext.Provider>
  );
}
