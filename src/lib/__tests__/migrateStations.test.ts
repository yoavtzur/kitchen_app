import { describe, expect, it } from 'vitest';
import { ensureStations } from '../migrateStations';
import type { AppState } from '../../types';

function stateWithoutStations(overrides: Record<string, unknown> = {}): Omit<AppState, 'stations'> {
  return {
    schemaVersion: 4,
    settings: { defaultCoverageDays: 1, weekStartsOn: 0, roundMultiplierTo: 0.25 },
    cooks: [],
    ingredients: [],
    products: [],
    recipes: [],
    tasks: [],
    taskOverrides: [],
    specialEvents: [],
    dayPlans: [],
    orderLines: [],
    ...overrides,
  } as Omit<AppState, 'stations'>;
}

describe('ensureStations', () => {
  it('backfills a real station for each distinct non-general category in use', () => {
    const state = stateWithoutStations({
      recipes: [
        { id: 'r1', name: 'א', category: 'hot', yieldQty: 1, yieldUnit: 'unit', items: [], steps: [] },
        { id: 'r2', name: 'ב', category: 'hot', yieldQty: 1, yieldUnit: 'unit', items: [], steps: [] },
      ],
      tasks: [
        { id: 't1', date: '2026-09-05', title: 'ג', categoryOverride: 'taboon', multiplier: 1, priority: 'red', done: false, source: 'manual' },
      ],
    });
    const next = ensureStations(state);
    expect(next.stations).toEqual(
      expect.arrayContaining([
        { id: 'hot', name: 'פס חם', createdAt: expect.any(String) },
        { id: 'taboon', name: 'טאבון', createdAt: expect.any(String) },
      ]),
    );
    expect(next.stations).toHaveLength(2);
  });

  it('never backs "general" with a Station row', () => {
    const state = stateWithoutStations({
      recipes: [{ id: 'r1', name: 'א', category: 'general', yieldQty: 1, yieldUnit: 'unit', items: [], steps: [] }],
    });
    expect(ensureStations(state).stations).toEqual([]);
  });

  it('is idempotent — state that already has a stations array is returned unchanged', () => {
    const existing = [{ id: 'station-1', name: 'פס חם', createdAt: '2026-01-01T00:00:00.000Z' }];
    const state = { ...stateWithoutStations(), stations: existing };
    expect(ensureStations(state)).toBe(state);
  });

  it('this is exactly what a real pre-existing Supabase restaurant snapshot looks like: no stations key, real recipe data, must not throw', () => {
    const legacySnapshot = stateWithoutStations({
      recipes: [{ id: 'r1', name: 'פיצה', category: 'taboon', yieldQty: 1, yieldUnit: 'unit', items: [], steps: [] }],
    });
    expect(() => ensureStations(legacySnapshot)).not.toThrow();
    expect(Array.isArray(ensureStations(legacySnapshot).stations)).toBe(true);
  });
});
