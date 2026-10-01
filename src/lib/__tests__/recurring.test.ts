import { describe, expect, it } from 'vitest';
import { reducer } from '../../store/reducer';
import { applyRestore, diffForRestore } from '../restore';
import { carryOver } from '../carryOver';
import { ALL_WEEKDAYS, daysLabel, materializeRecurring, recurringTaskId } from '../recurring';
import { getDisplayTasks } from '../tasks';
import type { AppState, RecurringTask, Task } from '../../types';

// 2026-10-11 is a Sunday, 2026-10-12 a Monday, 2026-10-14 a Wednesday.
const SUN = '2026-10-11';
const MON = '2026-10-12';
const WED = '2026-10-14';

function stateWith(overrides: Partial<AppState> = {}): AppState {
  return {
    schemaVersion: 5,
    settings: { defaultCoverageDays: 1, weekStartsOn: 0, roundMultiplierTo: null },
    cooks: [{ id: 'cook-1', name: 'דני', color: '#111' }],
    stations: [],
    ingredients: [], products: [], recipes: [], tasks: [], taskOverrides: [], specialEvents: [], dayPlans: [], orderLines: [],
    ...overrides,
  };
}

const rule = (extra: Partial<RecurringTask> = {}): RecurringTask => ({
  id: 'r1', title: 'ניקוי מדפים', days: ALL_WEEKDAYS, priority: 'yellow', ...extra,
});

describe('materializeRecurring', () => {
  it('makes an ordinary manual task on a day the rule is due', () => {
    const next = materializeRecurring(stateWith({ recurringTasks: [rule()] }), SUN);
    expect(next.tasks).toEqual([
      expect.objectContaining({
        id: recurringTaskId('r1', SUN), date: SUN, title: 'ניקוי מדפים', source: 'manual', done: false, multiplier: 1, recurringId: 'r1',
      }),
    ]);
    expect(next.recurringTasks?.[0].lastMaterialized).toBe(SUN);
  });

  it('carries the rule’s station, priority and assignee onto the task', () => {
    const next = materializeRecurring(
      stateWith({ recurringTasks: [rule({ categoryOverride: 'st-1', priority: 'red', assigneeId: 'cook-1' })] }),
      SUN,
    );
    expect(next.tasks[0]).toMatchObject({ categoryOverride: 'st-1', priority: 'red', assigneeId: 'cook-1' });
  });

  it('only makes it on the chosen weekdays', () => {
    const state = stateWith({ recurringTasks: [rule({ days: [0, 3] })] });
    expect(materializeRecurring(state, SUN).tasks).toHaveLength(1);
    expect(materializeRecurring(state, MON)).toBe(state);
    expect(materializeRecurring(state, WED).tasks).toHaveLength(1);
  });

  it('skips a paused rule', () => {
    const state = stateWith({ recurringTasks: [rule({ paused: true })] });
    expect(materializeRecurring(state, SUN)).toBe(state);
  });

  it('is idempotent: the second run the same day changes nothing', () => {
    const once = materializeRecurring(stateWith({ recurringTasks: [rule()] }), SUN);
    expect(materializeRecurring(once, SUN)).toBe(once);
  });

  it('does not bring back a task that was deleted today, but makes tomorrow’s', () => {
    const once = materializeRecurring(stateWith({ recurringTasks: [rule()] }), SUN);
    const deleted = reducer(once, { type: 'DELETE_TASK', id: recurringTaskId('r1', SUN) });
    expect(deleted.tasks).toHaveLength(0);
    expect(materializeRecurring(deleted, SUN)).toBe(deleted);
    expect(materializeRecurring(deleted, MON).tasks).toHaveLength(1);
  });

  it('does not stack: an instance still open is the task for today', () => {
    const open: Task = { id: recurringTaskId('r1', SUN), date: SUN, title: 'ניקוי מדפים', multiplier: 1, priority: 'yellow', done: false, source: 'manual', recurringId: 'r1' };
    const state = stateWith({ recurringTasks: [rule({ lastMaterialized: SUN })], tasks: [open] });
    const next = materializeRecurring(state, MON);
    expect(next.tasks).toHaveLength(1);
    expect(next.recurringTasks?.[0].lastMaterialized).toBe(MON);
  });

  it('makes a fresh one once the last was done', () => {
    const done: Task = { id: recurringTaskId('r1', SUN), date: SUN, title: 'ניקוי מדפים', multiplier: 1, priority: 'yellow', done: true, source: 'manual', recurringId: 'r1' };
    const next = materializeRecurring(stateWith({ recurringTasks: [rule({ lastMaterialized: SUN })], tasks: [done] }), MON);
    expect(next.tasks.map((t) => t.id)).toEqual([recurringTaskId('r1', SUN), recurringTaskId('r1', MON)]);
  });

  it('has nothing to do without rules', () => {
    const state = stateWith();
    expect(materializeRecurring(state, SUN)).toBe(state);
  });

  it('works with the carry-over: undone yesterday + due today gives ONE task, marked as carried', () => {
    let s = materializeRecurring(stateWith({ recurringTasks: [rule()] }), SUN);
    s = carryOver(s, MON); // DayRollover carries first…
    s = materializeRecurring(s, MON); // …then makes today's, which finds the carried one open
    expect(s.tasks).toHaveLength(1);
    expect(s.tasks[0]).toMatchObject({ date: MON, carriedFrom: SUN });
  });
});

describe('reducer actions', () => {
  it('ADD makes the rule and, when due, today’s task in one step', () => {
    const next = reducer(stateWith(), { type: 'ADD_RECURRING_TASK', rule: rule(), today: SUN });
    expect(next.recurringTasks).toHaveLength(1);
    expect(next.tasks).toHaveLength(1);
  });

  it('ADD on a day it is not due makes the rule but no task', () => {
    const next = reducer(stateWith(), { type: 'ADD_RECURRING_TASK', rule: rule({ days: [3] }), today: SUN });
    expect(next.recurringTasks).toHaveLength(1);
    expect(next.tasks).toHaveLength(0);
  });

  it('ADD ignores a blank title and a duplicate id, silently', () => {
    const state = stateWith();
    expect(reducer(state, { type: 'ADD_RECURRING_TASK', rule: rule({ title: '   ' }), today: SUN })).toBe(state);
    const once = reducer(state, { type: 'ADD_RECURRING_TASK', rule: rule(), today: SUN });
    expect(reducer(once, { type: 'ADD_RECURRING_TASK', rule: rule(), today: SUN })).toBe(once);
  });

  it('UPDATE changes future days and never resets which day was made', () => {
    const once = reducer(stateWith(), { type: 'ADD_RECURRING_TASK', rule: rule(), today: SUN });
    const edited = reducer(once, { type: 'UPDATE_RECURRING_TASK', rule: rule({ title: 'ניקוי מקרר', days: [1] }) });
    expect(edited.recurringTasks?.[0]).toMatchObject({ title: 'ניקוי מקרר', days: [1], lastMaterialized: SUN });
    // Saving twice in one day must not make today's task twice.
    expect(materializeRecurring(edited, SUN)).toBe(edited);
    expect(edited.tasks[0].title).toBe('ניקוי מדפים'); // today's already-made task is left alone
  });

  it('UPDATE and DELETE of an unknown rule are no-ops', () => {
    const state = stateWith();
    expect(reducer(state, { type: 'UPDATE_RECURRING_TASK', rule: rule() })).toBe(state);
    expect(reducer(state, { type: 'DELETE_RECURRING_TASK', id: 'nope' })).toBe(state);
  });

  it('DELETE removes the rule but not tasks it already made', () => {
    const once = reducer(stateWith(), { type: 'ADD_RECURRING_TASK', rule: rule(), today: SUN });
    const gone = reducer(once, { type: 'DELETE_RECURRING_TASK', id: 'r1' });
    expect(gone.recurringTasks).toEqual([]);
    expect(gone.tasks).toHaveLength(1);
  });

  it('a deleted rule comes back with one undo (restore)', () => {
    const once = reducer(stateWith(), { type: 'ADD_RECURRING_TASK', rule: rule(), today: SUN });
    const gone = reducer(once, { type: 'DELETE_RECURRING_TASK', id: 'r1' });
    const back = applyRestore(gone, diffForRestore(once, gone));
    expect(back.recurringTasks).toEqual(once.recurringTasks);
  });

  it.each([
    ['ADD_RECURRING_TASK', { type: 'ADD_RECURRING_TASK', rule: rule({ days: [0, 2] }), today: SUN }],
    ['MATERIALIZE_RECURRING', { type: 'MATERIALIZE_RECURRING', today: SUN }],
  ] as const)('%s survives the JSON round trip an op takes', (_name, action) => {
    const state = stateWith({ recurringTasks: [rule()] });
    expect(reducer(state, JSON.parse(JSON.stringify(action)))).toEqual(reducer(state, action));
  });
});

describe('what a cook sees', () => {
  it('shows the task as a normal manual task, tagged as recurring', () => {
    const next = reducer(stateWith(), { type: 'ADD_RECURRING_TASK', rule: rule(), today: SUN });
    const [shown] = getDisplayTasks(SUN, next);
    expect(shown).toMatchObject({ title: 'ניקוי מדפים', source: 'manual', recurring: true });
  });
});

describe('daysLabel', () => {
  it('says "כל יום" for all seven and lists the rest in week order', () => {
    expect(daysLabel(ALL_WEEKDAYS)).toBe('כל יום');
    expect(daysLabel([3, 0])).toBe('א׳ · ד׳');
    expect(daysLabel([])).toBe('—');
  });
});
