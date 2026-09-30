import { useEffect, useRef, useState } from 'react';
import { resolveAxis, shouldComplete, type SwipeAxis } from '../lib/swipe';

type Props = {
  onComplete: () => void;
  disabled?: boolean;
  /** Text shown on the reveal panel behind the card as it's dragged aside. */
  label?: string;
  children: React.ReactNode;
};

/**
 * Installs a one-shot, capture-phase `click` swallower.
 *
 * A touch sequence is followed by a synthetic `click` on whatever was under the finger. When
 * that is a control inside the swiped card, the swipe's own action and the control's `onClick`
 * both run. Capture phase means this sees the event before the target does; `{ once: true }`
 * plus the explicit `removeEventListener` means a swipe that ends over nothing clickable
 * doesn't leave a listener armed to eat the cook's next real tap.
 */
function suppressNextClick() {
  if (typeof document === 'undefined') return;
  const swallow = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    document.removeEventListener('click', swallow, true);
    window.clearTimeout(timer);
  };
  document.addEventListener('click', swallow, true);
  // If no click follows (the usual case — a swipe ending on empty card space), disarm rather
  // than wait for one. 400ms comfortably covers the browser's synthetic-click delay.
  const timer = window.setTimeout(() => document.removeEventListener('click', swallow, true), 400);
}

/**
 * Wraps a card so a horizontal drag either way triggers `onComplete`. Vertical drags are
 * abandoned immediately so the page's native scroll takes over — see the `.swipe-surface`
 * touch-action rule, which is what actually guarantees scrolling can never be blocked.
 */
export function SwipeToComplete({ onComplete, disabled, label = '✓ בוצע', children }: Props) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const axisRef = useRef<SwipeAxis>('undecided');
  const [dx, setDx] = useState(0);
  const [releasing, setReleasing] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function reset() {
    if (!mountedRef.current) return;
    startRef.current = null;
    axisRef.current = 'undecided';
    setDx(0);
  }

  function onTouchStart(e: React.TouchEvent) {
    if (disabled) return;
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    if (!touch) return;
    startRef.current = { x: touch.clientX, y: touch.clientY };
    axisRef.current = 'undecided';
    setReleasing(false);
  }

  function onTouchMove(e: React.TouchEvent) {
    const start = startRef.current;
    if (!start || disabled) return;
    if (e.touches.length !== 1) {
      reset();
      return;
    }
    const touch = e.touches[0];
    if (!touch) {
      reset();
      return;
    }
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;

    if (axisRef.current === 'undecided') {
      axisRef.current = resolveAxis(deltaX, deltaY);
    }
    if (axisRef.current === 'vertical') return;
    if (axisRef.current === 'horizontal') {
      setDx(deltaX);
    }
  }

  function onTouchEnd() {
    const start = startRef.current;
    if (!start || disabled) {
      reset();
      return;
    }
    if (axisRef.current === 'horizontal') {
      const width = surfaceRef.current?.offsetWidth ?? 0;
      if (shouldComplete(dx, width)) {
        // Swallow the synthetic click the browser fires after a touch sequence.
        //
        // Without this, a swipe that ends with the finger over a button inside the card fires
        // BOTH `onComplete` and that button's `onClick`. With the accessible checkbox now
        // sitting inside `.swipe-surface` and calling the same handlers, that means marking a
        // task done and immediately undoing it — leaving it exactly where it started.
        // Intermittent, touch-only, and invisible in any test that doesn't swipe over the
        // control. One-shot and capture-phase so it beats the target's own listener, and it
        // removes itself either way.
        suppressNextClick();
        setReleasing(true);
        setDx(dx < 0 ? -width : width);
        onComplete();
        window.setTimeout(reset, 200);
        return;
      }
    }
    setReleasing(true);
    reset();
  }

  return (
    <div className="swipe-wrap">
      <div className="swipe-action" aria-hidden="true">
        {label}
      </div>
      <div
        ref={surfaceRef}
        className="swipe-surface"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={reset}
        style={{
          transform: dx ? `translateX(${dx}px)` : undefined,
          transition: releasing ? 'transform 0.2s ease' : 'none',
        }}
      >
        {children}
      </div>
    </div>
  );
}
