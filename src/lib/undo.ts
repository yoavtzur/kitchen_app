import { createContext, useContext } from 'react';
import type { Action } from '../store/reducer';

/** How long the "בטל" stays on screen. Short on purpose: it replaces an "are you sure?" dialog
 * that cost a tap on every action, so it has to be quick to ignore as well as quick to use. */
export const UNDO_MS = 4000;

export type UndoApi = {
  /** Shows "<message> · בטל" for `UNDO_MS`. A newer one replaces the one on screen: only the most
   * recent action is undoable, which is also the only one a cook who just made a mistake means. */
  showUndo(message: string, onUndo: () => void): void;
  /** Dispatches a deleting action and offers to put back exactly what it removed. */
  deleteWithUndo(action: Action, message: string): void;
};

export const UndoContext = createContext<UndoApi | undefined>(undefined);

export function useUndo(): UndoApi {
  const ctx = useContext(UndoContext);
  if (!ctx) throw new Error('useUndo must be used within UndoProvider');
  return ctx;
}
