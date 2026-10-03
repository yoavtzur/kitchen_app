import { describe, expect, it } from 'vitest';
import { createSeedState } from '../../data/seed';
import { shiftCook, shiftsOn, withShift } from '../schedule';
import { getDisplayTasks } from '../tasks';
import { reducer } from '../../store/reducer';
import type { AppState } from '../../types';

const date = '2026-10-03';

function state(): AppState {
  const s = createSeedState();
  return {
    ...s,
    stations: [{ id: 'hot', name: 'חם', createdAt: '2026-01-01' }],
    tasks: [
      { id: 'm1', date, title: 'א', multiplier: 1, priority: 'yellow', done: false, source: 'manual', categoryOverride: 'hot' },
      { id: 'm2', date, title: 'ב', multiplier: 1, priority: 'yellow', done: false, source: 'manual', categoryOverride: 'hot', assigneeId: 'cook-2' },
      { id: 'm3', date, title: 'ג', multiplier: 1, priority: 'yellow', done: false, source: 'manual' },
    ],
  };
}

describe('schedule', () => {
  it('withShift sets, replaces and clears one slot', () => {
    let s = withShift(undefined, date, 'hot', 'cook-1');
    s = withShift(s, date, 'hot', 'cook-2');
    expect(s).toEqual([{ date, stationId: 'hot', cookId: 'cook-2' }]);
    expect(withShift(s, date, 'hot', null)).toEqual([]);
  });

  it('ignores a cook that no longer exists', () => {
    const s = { ...state(), stationShifts: [{ date, stationId: 'hot', cookId: 'gone' }] };
    expect(shiftCook(s, date, 'hot')).toBeUndefined();
    expect(shiftsOn(s, date).size).toBe(0);
  });

  it('unassigned station tasks show as the scheduled cook; a hand-picked cook wins', () => {
    const s = reducer(state(), { type: 'SET_STATION_COOK', date, stationId: 'hot', cookId: 'cook-1' });
    const byId = new Map(getDisplayTasks(date, s).map((t) => [t.id, t]));
    expect(byId.get('m1')).toMatchObject({ assigneeId: 'cook-1', assigneeFromSchedule: true });
    expect(byId.get('m2')?.assigneeId).toBe('cook-2');
    expect(byId.get('m2')?.assigneeFromSchedule).toBeUndefined();
    expect(byId.get('m3')?.assigneeId).toBeUndefined();
    // Nothing is written onto the task itself.
    expect(s.tasks.find((t) => t.id === 'm1')?.assigneeId).toBeUndefined();
    // Another day is untouched.
    expect(getDisplayTasks('2026-10-04', { ...s, tasks: s.tasks.map((t) => ({ ...t, date: '2026-10-04' })) }).find((t) => t.id === 'm1')?.assigneeId).toBeUndefined();
  });

  it('SET_STATION_COOK survives a JSON round trip, including the clear', () => {
    const a = { type: 'SET_STATION_COOK' as const, date, stationId: 'hot', cookId: null };
    const s = reducer(state(), { ...a, cookId: 'cook-1' });
    expect(reducer(s, JSON.parse(JSON.stringify(a)))).toEqual(reducer(s, a));
    expect(reducer(s, a).stationShifts).toEqual([]);
  });
});
