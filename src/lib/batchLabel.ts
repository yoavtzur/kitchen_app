import { createContext, useContext } from 'react';
import type { BatchLabel } from './expiry';

export type BatchLabelApi = {
  /** Shows what to write on the container for a batch just made. `onUndo` is offered in the sheet
   * itself: the sheet stands in for the "בטל" toast, which would sit behind it. */
  showBatchLabel(label: BatchLabel, onUndo: () => void): void;
};

export const BatchLabelContext = createContext<BatchLabelApi | undefined>(undefined);

export function useBatchLabel(): BatchLabelApi {
  const ctx = useContext(BatchLabelContext);
  if (!ctx) throw new Error('useBatchLabel must be used within BatchLabelProvider');
  return ctx;
}
