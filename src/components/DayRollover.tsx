import { useEffect } from 'react';
import { useApp } from '../store/AppContext';
import { carryOver } from '../lib/carryOver';
import { useToday } from '../lib/useToday';

/**
 * Starts each day by moving unfinished work onto it (see lib/carryOver.ts).
 *
 * It lives at the layout level, beside the other context components, and not on the task screen:
 * the open-task badge in the bottom nav counts the same list, so it has to be right on whichever
 * screen the app lands on. Renders nothing.
 *
 * Sending the action is guarded by asking the pure function whether it would change anything, so
 * a day with nothing to carry costs no op at all. Several devices opening in the same minute each
 * send it; that is harmless by construction (the first one makes the rest no-ops), and a device
 * that has already seen the result does not send.
 */
export function DayRollover() {
  const { state, dispatch } = useApp();
  const today = useToday();

  useEffect(() => {
    if (carryOver(state, today) !== state) dispatch({ type: 'CARRY_OVER_TASKS', today });
  }, [state, today, dispatch]);

  return null;
}
