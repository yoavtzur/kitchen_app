import { useEffect, useState } from 'react';

/** `true` only once `show` has been true for `ms` straight; goes false immediately when it stops.
 * Keeps a routine reconnect — a state that lasts a second or two — from flashing sync chrome. */
export function useDelayedVisible(show: boolean, ms: number): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!show) {
      setVisible(false);
      return;
    }
    const t = setTimeout(() => setVisible(true), ms);
    return () => clearTimeout(t);
  }, [show, ms]);
  return show && visible;
}
