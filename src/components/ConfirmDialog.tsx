import type { ReactNode } from 'react';
import { BottomSheet } from './BottomSheet';

type Props = {
  title: string;
  onClose: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
  destructive?: boolean;
  children: ReactNode;
};

export function ConfirmDialog({
  title,
  onClose,
  onConfirm,
  confirmLabel = 'אישור',
  destructive = false,
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
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </BottomSheet>
  );
}
