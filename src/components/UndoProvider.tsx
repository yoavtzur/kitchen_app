import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApp } from '../store/AppContext';
import { reducer } from '../store/reducer';
import { diffForRestore } from '../lib/restore';
import { UNDO_MS, UndoContext, type UndoApi } from '../lib/undo';
import { Toast } from './Toast';

/**
 * Owns the one floating "בטל" toast for the whole app.
 *
 * It lives here rather than in the screen that triggered the action because the control that
 * triggered it is usually gone a moment later: a delete is confirmed from inside a `BottomSheet`
 * that closes itself, and a toast rendered by that sheet would leave with it. This provider sits
 * above `<Outlet />` and inside `AppProvider` (it needs `dispatch` to undo), so it survives both
 * the sheet closing and a navigation.
 */
export function UndoProvider({ children }: { children: ReactNode }) {
  const { state, dispatch } = useApp();
  const [current, setCurrent] = useState<{ message: string; onUndo: () => void } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const showUndo = useCallback((message: string, onUndo: () => void) => {
    window.clearTimeout(timer.current);
    setCurrent({ message, onUndo });
    timer.current = window.setTimeout(() => setCurrent(null), UNDO_MS);
  }, []);

  const api = useMemo<UndoApi>(
    () => ({
      showUndo,
      deleteWithUndo(action, message) {
        // The reducer is pure, so the "after" state can be computed without dispatching: the diff
        // against it is exactly what this deletion takes out, however far `pruneEntities` reaches.
        const restore = diffForRestore(state, reducer(state, action));
        dispatch(action);
        showUndo(message, () => dispatch({ type: 'RESTORE_ENTITIES', restore }));
      },
    }),
    [state, dispatch, showUndo],
  );

  function undo() {
    if (!current) return;
    window.clearTimeout(timer.current);
    current.onUndo();
    setCurrent(null);
  }

  return (
    <UndoContext.Provider value={api}>
      {children}
      {current && <Toast message={current.message} action={{ label: 'בטל', onClick: undo }} />}
    </UndoContext.Provider>
  );
}
