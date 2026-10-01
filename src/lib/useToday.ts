import { useEffect, useState } from 'react';
import { todayStr } from './date';

/** Milliseconds from `now` to the next local midnight. Pure, so the boundary is testable. */
export function msUntilMidnight(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime();
}

/**
 * Today's date, kept current.
 *
 * `todayStr()` read once at mount goes stale in exactly the situation a kitchen is in: the app is
 * open on a shelf or a tablet overnight, and in the morning it still thinks it is yesterday — no
 * new day's tasks, nothing carried over. So this re-reads the date when the page becomes visible or
 * focused again (a phone coming out of a pocket) and at the next midnight.
 *
 * The timer is rescheduled from the real clock each time rather than as a fixed 24h, so a device
 * that slept through midnight (timers are throttled or frozen in the background) still lands on the
 * right day the moment it wakes.
 */
export function useToday(): string {
  const [today, setToday] = useState(todayStr);

  useEffect(() => {
    let timer: number | undefined;
    const refresh = () => {
      setToday(todayStr());
      window.clearTimeout(timer);
      // +1s of slack: a timer that fires a hair early would re-read the same date and sleep a day.
      timer = window.setTimeout(refresh, msUntilMidnight(new Date()) + 1000);
    };
    refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  return today;
}
