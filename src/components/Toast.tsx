import { useEffect, useState } from 'react';

type Props = {
  message: string;
  onDismiss: () => void;
  durationMs?: number;
};

/** A transient success notice, self-dismissing after `durationMs`. No portal (matches
 * BottomSheet's own plain-DOM-nesting convention) — positioned via fixed CSS instead. */
export function Toast({ message, onDismiss, durationMs = 2500 }: Props) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const showTimer = setTimeout(() => setVisible(false), durationMs);
    return () => clearTimeout(showTimer);
  }, [durationMs]);

  useEffect(() => {
    if (visible) return;
    const removeTimer = setTimeout(onDismiss, 250); // matches the CSS transition duration below
    return () => clearTimeout(removeTimer);
  }, [visible, onDismiss]);

  return (
    <div className="toast-wrap">
      <div className={`toast ${visible ? 'toast-visible' : 'toast-hidden'}`} role="status">
        {message}
      </div>
    </div>
  );
}
