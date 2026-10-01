import type { ReactNode } from 'react';
import { BottomSheet } from './BottomSheet';

type Props = {
  title: string;
  onClose: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
  destructive?: boolean;
  /** Blocks confirmation until the caller says otherwise — for a dialog whose `children` ask the
   * user to type something first. Cancel always stays live. */
  confirmDisabled?: boolean;
  children: ReactNode;
};

export function ConfirmDialog({
  title,
  onClose,
  onConfirm,
  confirmLabel = 'אישור',
  destructive = false,
  confirmDisabled = false,
  children,
}: Props) {
  return (
    <BottomSheet title={title} onClose={onClose}>
      <div className="stack-gap-3" style={{ marginBottom: 'var(--space-4)' }}>
        {children}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn" style={{ flex: 1 }} onClick={onClose}>
          ביטול
        </button>
        <button
          type="button"
          className={`btn ${destructive ? 'btn-danger' : 'btn-primary'}`}
          style={{ flex: 1 }}
          disabled={confirmDisabled}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </BottomSheet>
  );
}
