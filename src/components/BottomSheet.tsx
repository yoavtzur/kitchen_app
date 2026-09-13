import { useEffect, useId, type ReactNode } from 'react';

type Props = {
  title: string;
  onClose: () => void;
  children: ReactNode;
};

export function BottomSheet({ title, onClose, children }: Props) {
  const titleId = useId();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="overlay">
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="sheet-header">
          <h2 id={titleId} style={{ fontSize: 18, fontWeight: 700 }}>{title}</h2>
          <button type="button" className="btn btn-icon" onClick={onClose} aria-label="סגור">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
