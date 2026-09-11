import { useEffect, useRef, useState } from 'react';
import { resolveAxis, shouldComplete, type SwipeAxis } from '../lib/swipe';

type Props = {
  onComplete: () => void;
  disabled?: boolean;
  children: React.ReactNode;
};

/**
 * Wraps a card so a horizontal drag either way completes it. Vertical drags are abandoned
 * immediately so the page's native scroll takes over — see the `.swipe-surface` touch-action
 * rule, which is what actually guarantees scrolling can never be blocked.
 */
export function SwipeToComplete({ onComplete, disabled, children }: Props) {
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
        ✓ בוצע
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
