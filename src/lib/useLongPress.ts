import { useCallback, useEffect, useRef, type MouseEvent, type PointerEvent } from 'react';

/** How long a finger has to stay down for it to count as a long press. */
export const LONG_PRESS_MS = 500;
/** How far it may wander and still be "holding still" — a thumb on a wet screen drifts. */
export const LONG_PRESS_SLOP_PX = 10;

/** Whether a finger has moved far enough from where it landed to stop being a press. */
export function movedTooFar(dx: number, dy: number, slop = LONG_PRESS_SLOP_PX): boolean {
  return Math.hypot(dx, dy) > slop;
}

/**
 * Tap and long-press on one element.
 *
 * The tap is a real `click`, not a pointer-up, so Enter and Space on a focused button still work
 * and the control stays usable without a touchscreen. The one thing that needs care is the click
 * that follows a long press: it must not also count as a tap, so the press records that it fired
 * and the next click is swallowed. Scrolling cancels it (`pointercancel`, or moving past the
 * slop), and the context menu is blocked because a long press is exactly what mobile browsers use
 * to open one.
 */
export function useLongPress({ onTap, onLongPress, ms = LONG_PRESS_MS }: { onTap: () => void; onLongPress: () => void; ms?: number }) {
  const timer = useRef<number | undefined>(undefined);
  const fired = useRef(false);
  const origin = useRef<{ x: number; y: number } | null>(null);

  const cancel = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  useEffect(() => cancel, [cancel]);

  return {
    onPointerDown: (e: PointerEvent) => {
      fired.current = false;
      origin.current = { x: e.clientX, y: e.clientY };
      cancel();
      timer.current = window.setTimeout(() => {
        fired.current = true;
        onLongPress();
      }, ms);
    },
    onPointerMove: (e: PointerEvent) => {
      if (origin.current && movedTooFar(e.clientX - origin.current.x, e.clientY - origin.current.y)) cancel();
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: MouseEvent) => e.preventDefault(),
    onClick: (e: MouseEvent) => {
      if (fired.current) {
        fired.current = false;
        e.preventDefault();
        return;
      }
      onTap();
    },
  };
}
