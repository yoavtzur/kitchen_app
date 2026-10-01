import { dayOfWeek, dayShortLabel } from './date';
import type { AppState, RecurringTask, Task, Weekday } from '../types';

/**
 * Tasks that come back by themselves.
 *
 * A rule (`RecurringTask`) makes an ordinary manual `Task` for each day it is due. That is the whole
 * design: a task made from a rule is, from the first moment, indistinguishable from one a person
 * typed — it can be completed, assigned, re-prioritised, deleted, undone, and carried over to the
 * next day if left open, all by code that already exists and with no second display path to keep
 * in step. Only the `recurringId` field remembers where it came from.
 *
 * Pure, and it takes `today` as an argument: the reducer never reads the clock, so every device
 * replaying the op lands on the same state. It returns the **same object** when there is nothing to
 * do — which is how the caller asks "is there anything to make?", and what makes the action
 * idempotent.
 */

export const ALL_WEEKDAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6];

/** The task id for a rule on a day: deterministic, so two devices making the same day's task make
 * the *same* task, and there is no random id to differ between them. */
export function recurringTaskId(ruleId: string, date: string): string {
  return `rec-${ruleId}-${date}`;
}

function isDue(rule: RecurringTask, today: string): boolean {
  return !rule.paused && rule.days.includes(dayOfWeek(today)) && rule.lastMaterialized !== today;
}

export function materializeRecurring(state: AppState, today: string): AppState {
  const rules = state.recurringTasks;
  if (!rules || !rules.some((r) => isDue(r, today))) return state;

  const created: Task[] = [];
  const nextRules = rules.map((rule) => {
    if (!isDue(rule, today)) return rule;
    // An instance still open — typically yesterday's, carried over to today — is *the* task for
    // this rule. A daily task left undone must not pile up into a stack of identical ones.
    const alreadyOpen = state.tasks.some((t) => t.recurringId === rule.id && !t.done);
    if (!alreadyOpen) {
      created.push({
        id: recurringTaskId(rule.id, today),
        date: today,
        title: rule.title,
        categoryOverride: rule.categoryOverride,
        multiplier: 1,
        priority: rule.priority,
        assigneeId: rule.assigneeId,
        done: false,
        source: 'manual',
        recurringId: rule.id,
      });
    }
    // Marked even when nothing was made: the rule has answered for today. Without this, deleting
    // today's task would let the next run make it again.
    return { ...rule, lastMaterialized: today };
  });

  return { ...state, recurringTasks: nextRules, tasks: created.length > 0 ? [...state.tasks, ...created] : state.tasks };
}

/** "כל יום", or the chosen days in week order: "א׳ · ד׳". */
export function daysLabel(days: readonly Weekday[]): string {
  const unique = ALL_WEEKDAYS.filter((d) => days.includes(d));
  if (unique.length === 0) return '—';
  if (unique.length === 7) return 'כל יום';
  return unique.map(dayShortLabel).join(' · ');
}
