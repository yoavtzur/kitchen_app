import { addDays } from './date';
import { autoTaskId } from './tasks';
import type { AppState, AutoTaskOverride, Task } from '../types';

/**
 * What happens to unfinished work when the day changes.
 *
 * Before this, a *manual* task left open at closing simply stopped being on the list the next
 * morning: the list shows `task.date === date`, so yesterday's task was still in the data and
 * nowhere on screen — no overdue marker, no count in the nav badge, nothing. (Auto tasks never had
 * that problem: they are recomputed from stock, so an undone one is back the next day on its own.)
 *
 * This is a real action (`CARRY_OVER_TASKS`) rather than something derived at display time, because
 * a manual task that has moved to today is then an ordinary task of today: completing it, the
 * per-cook "done today" count and every card action work unchanged. A derived version would leave a
 * task finished today filed under yesterday.
 *
 * Pure, and it takes `today` as an argument — the reducer never reads the clock, so every device
 * replaying the op lands on the same state. It returns the **same object** when there is nothing to
 * move, which is how the caller asks "is there anything to do?" without a second function, and what
 * makes the action idempotent: once the tasks are on `today` and the override rows exist, a second
 * run finds nothing.
 */

/** How far back an auto task's assignee / manual priority is still carried. A week covers a
 * weekend and a day off; an assignment from three weeks ago is a stale note, not a plan. */
export const AUTO_CARRY_DAYS = 7;

/** An override worth carrying: someone is assigned, or a person set the priority by hand. */
function hasCarryableChoice(o: AutoTaskOverride): boolean {
  return Boolean(o.assigneeId) || Boolean(o.priorityManual && o.priority);
}

export function carryOver(state: AppState, today: string): AppState {
  const tasks = carryManualTasks(state.tasks, today);
  const taskOverrides = carryAutoChoices(state.taskOverrides, today);
  if (tasks === state.tasks && taskOverrides === state.taskOverrides) return state;
  return { ...state, tasks, taskOverrides };
}

/** Open manual tasks from an earlier day become tasks of `today`, remembering the day they were
 * first planned for (kept across several carries, so "3 days ago" does not reset every morning). */
function carryManualTasks(tasks: Task[], today: string): Task[] {
  if (!tasks.some((t) => !t.done && t.date < today)) return tasks;
  return tasks.map((t) =>
    !t.done && t.date < today ? { ...t, date: today, carriedFrom: t.carriedFrom ?? t.date } : t,
  );
}

/**
 * Carries the *choices* made on an auto task — who it is for and a hand-set priority — to today.
 *
 * Only the most recent earlier row per product is looked at, and only if it was neither done nor
 * dismissed: a finished task means the work was done (a new need today is a fresh job), and a
 * dismissal is deliberately **not** carried — a real need must not stay hidden forever because it
 * was waved away once. An existing row for today always wins.
 */
function carryAutoChoices(overrides: AutoTaskOverride[], today: string): AutoTaskOverride[] {
  const oldest = addDays(today, -AUTO_CARRY_DAYS);
  const latestBefore = new Map<string, AutoTaskOverride>();
  const hasToday = new Set<string>();
  for (const o of overrides) {
    if (o.date === today) hasToday.add(o.productId);
    if (o.date >= today) continue;
    const seen = latestBefore.get(o.productId);
    if (!seen || o.date > seen.date) latestBefore.set(o.productId, o);
  }

  const added: AutoTaskOverride[] = [];
  for (const [productId, o] of latestBefore) {
    if (hasToday.has(productId) || o.date < oldest) continue;
    if (o.done || o.dismissed || !hasCarryableChoice(o)) continue;
    added.push({
      id: autoTaskId(productId, today),
      productId,
      date: today,
      ...(o.assigneeId ? { assigneeId: o.assigneeId } : {}),
      ...(o.priorityManual && o.priority ? { priority: o.priority, priorityManual: true } : {}),
    });
  }
  return added.length === 0 ? overrides : [...overrides, ...added];
}
