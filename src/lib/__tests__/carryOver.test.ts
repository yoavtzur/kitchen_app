import { describe, expect, it } from 'vitest';
import { reducer } from '../../store/reducer';
import { AUTO_CARRY_DAYS, carryOver } from '../carryOver';
import { daysBetween } from '../date';
import { autoTaskId, getDisplayTasks } from '../tasks';
import { msUntilMidnight } from '../useToday';
import type { AppState, AutoTaskOverride, Product, Recipe, Task } from '../../types';

const today = '2026-10-10';

function stateWith(overrides: Partial<AppState> = {}): AppState {
  return {
    schemaVersion: 5,
    settings: { defaultCoverageDays: 1, weekStartsOn: 0, roundMultiplierTo: null },
    cooks: [{ id: 'cook-1', name: 'דני', color: '#111' }],
    stations: [],
    ingredients: [],
    products: [],
    recipes: [],
    tasks: [],
    taskOverrides: [],
    specialEvents: [],
    dayPlans: [],
    orderLines: [],
    ...overrides,
  };
}

const task = (id: string, date: string, extra: Partial<Task> = {}): Task => ({
  id, date, title: id, multiplier: 1, priority: 'yellow', done: false, source: 'manual', ...extra,
});
const override = (productId: string, date: string, extra: Partial<AutoTaskOverride> = {}): AutoTaskOverride => ({
  id: autoTaskId(productId, date), productId, date, ...extra,
});

describe('manual tasks', () => {
  it('moves an open task from an earlier day onto today and remembers when it was planned', () => {
    const next = carryOver(stateWith({ tasks: [task('a', '2026-10-09')] }), today);
    expect(next.tasks[0]).toMatchObject({ id: 'a', date: today, carriedFrom: '2026-10-09' });
  });

  it('keeps the ORIGINAL day across several carries, so "3 days ago" does not reset each morning', () => {
    const day1 = carryOver(stateWith({ tasks: [task('a', '2026-10-07')] }), '2026-10-08');
    const day3 = carryOver(day1, today);
    expect(day3.tasks[0]).toMatchObject({ date: today, carriedFrom: '2026-10-07' });
  });

  it('leaves finished tasks, today’s tasks and future tasks alone', () => {
    const state = stateWith({
      tasks: [task('done', '2026-10-09', { done: true }), task('now', today), task('later', '2026-10-12')],
    });
    expect(carryOver(state, today)).toBe(state);
  });

  it('is idempotent and returns the same object when there is nothing to do', () => {
    const once = carryOver(stateWith({ tasks: [task('a', '2026-10-09')] }), today);
    expect(carryOver(once, today)).toBe(once);
  });

  it('carries a task with no limit — an old open task stays until it is done or deleted', () => {
    const next = carryOver(stateWith({ tasks: [task('old', '2026-08-01')] }), today);
    expect(next.tasks[0]).toMatchObject({ date: today, carriedFrom: '2026-08-01' });
  });
});

describe('auto tasks', () => {
  const assigned = (date: string, extra: Partial<AutoTaskOverride> = {}) => override('p1', date, { assigneeId: 'cook-1', ...extra });

  it('carries the assignee to today', () => {
    const next = carryOver(stateWith({ taskOverrides: [assigned('2026-10-09')] }), today);
    expect(next.taskOverrides).toHaveLength(2);
    expect(next.taskOverrides[1]).toEqual({ id: autoTaskId('p1', today), productId: 'p1', date: today, assigneeId: 'cook-1' });
  });

  it('carries a hand-set priority, but not an automatic one', () => {
    const manual = carryOver(stateWith({ taskOverrides: [override('p1', '2026-10-09', { priority: 'red', priorityManual: true })] }), today);
    expect(manual.taskOverrides[1]).toMatchObject({ priority: 'red', priorityManual: true });
    const auto = override('p2', '2026-10-09', { priority: 'red' });
    const state = stateWith({ taskOverrides: [auto] });
    expect(carryOver(state, today)).toBe(state);
  });

  it('does NOT carry a dismissal, even from a row that also has an assignee', () => {
    const state = stateWith({ taskOverrides: [assigned('2026-10-09', { dismissed: true })] });
    expect(carryOver(state, today)).toBe(state);
  });

  it('does not carry from a task that was finished', () => {
    const state = stateWith({ taskOverrides: [assigned('2026-10-09', { done: true })] });
    expect(carryOver(state, today)).toBe(state);
  });

  it('looks only at the most recent earlier row: a finished one stops the search', () => {
    const state = stateWith({ taskOverrides: [assigned('2026-10-08'), assigned('2026-10-09', { done: true })] });
    expect(carryOver(state, today)).toBe(state);
  });

  it('never overwrites a row that already exists for today', () => {
    const state = stateWith({ taskOverrides: [assigned('2026-10-09'), override('p1', today, { assigneeId: undefined })] });
    expect(carryOver(state, today)).toBe(state);
  });

  it('stops carrying after AUTO_CARRY_DAYS', () => {
    const edge = stateWith({ taskOverrides: [assigned(`2026-10-0${10 - AUTO_CARRY_DAYS}`)] });
    expect(carryOver(edge, today).taskOverrides).toHaveLength(2);
    const stale = stateWith({ taskOverrides: [assigned('2026-10-02')] });
    expect(carryOver(stale, today)).toBe(stale);
  });

  it('is idempotent', () => {
    const once = carryOver(stateWith({ taskOverrides: [assigned('2026-10-09')] }), today);
    expect(carryOver(once, today)).toBe(once);
  });
});

describe('the whole chain', () => {
  const product: Product = { id: 'p1', name: 'קרם', kind: 'menu', unit: 'unit', currentQty: 0, weeklyTarget: 40, dailyUsage: 15, recipeId: 'r1' };
  const recipe: Recipe = { id: 'r1', name: 'קרם', category: 'general', yieldQty: 8, yieldUnit: 'unit', producesProductId: 'p1', items: [], steps: [] };

  it('shows the carried-over manual task and the inherited assignee in today’s list', () => {
    const state = stateWith({
      products: [product],
      recipes: [recipe],
      tasks: [task('clean', '2026-10-09')],
      taskOverrides: [override('p1', '2026-10-09', { assigneeId: 'cook-1' })],
    });
    expect(getDisplayTasks(today, state).map((t) => t.id)).toEqual([autoTaskId('p1', today)]);

    const next = reducer(state, { type: 'CARRY_OVER_TASKS', today });
    const list = getDisplayTasks(today, next);
    expect(list.find((t) => t.source === 'manual')).toMatchObject({ id: 'clean', carriedFrom: '2026-10-09' });
    expect(list.find((t) => t.source === 'auto')?.assigneeId).toBe('cook-1');
  });

  it('survives the JSON round trip an op takes', () => {
    const state = stateWith({ tasks: [task('a', '2026-10-09')], taskOverrides: [override('p1', '2026-10-09', { assigneeId: 'cook-1' })] });
    const action = { type: 'CARRY_OVER_TASKS', today } as const;
    expect(reducer(state, JSON.parse(JSON.stringify(action)))).toEqual(reducer(state, action));
  });
});

describe('daysBetween', () => {
  it('counts whole days, across month and year ends', () => {
    expect(daysBetween('2026-10-09', '2026-10-10')).toBe(1);
    expect(daysBetween('2026-09-28', '2026-10-02')).toBe(4);
    expect(daysBetween('2025-12-30', '2026-01-02')).toBe(3);
    expect(daysBetween('2026-10-10', '2026-10-10')).toBe(0);
    expect(daysBetween('2026-10-10', '2026-10-09')).toBe(-1);
  });

  it('is not thrown off by a daylight-saving change in between', () => {
    expect(daysBetween('2026-03-26', '2026-03-30')).toBe(4);
    expect(daysBetween('2026-10-24', '2026-10-27')).toBe(3);
  });
});

describe('msUntilMidnight', () => {
  it('is the time left in the local day', () => {
    expect(msUntilMidnight(new Date(2026, 9, 10, 23, 59, 0))).toBe(60_000);
    expect(msUntilMidnight(new Date(2026, 9, 10, 0, 0, 0))).toBe(24 * 3_600_000);
    expect(msUntilMidnight(new Date(2026, 9, 31, 12, 0, 0))).toBe(12 * 3_600_000);
  });
});
