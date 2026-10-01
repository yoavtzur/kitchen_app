import { useEffect } from 'react';
import { useApp } from '../store/AppContext';
import { carryOver } from '../lib/carryOver';
import { materializeRecurring } from '../lib/recurring';
import { useToday } from '../lib/useToday';

/**
 * Starts each day: moves unfinished work onto it (lib/carryOver.ts), then makes today's tasks from
 * the standing ones (lib/recurring.ts).
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
    // In this order: carrying yesterday's open task over first is what stops a standing task that
    // was left undone from being made a second time. Each dispatch changes `state` and re-runs this.
    if (carryOver(state, today) !== state) dispatch({ type: 'CARRY_OVER_TASKS', today });
    else if (materializeRecurring(state, today) !== state) dispatch({ type: 'MATERIALIZE_RECURRING', today });
  }, [state, today, dispatch]);

  return null;
}
