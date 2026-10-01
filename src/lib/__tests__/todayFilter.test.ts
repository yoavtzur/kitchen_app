import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readStoredStation, resolveStation, writeStoredStation } from '../todayFilter';
import { TODAY_STATION_KEY } from '../resetLocalData';

const stations = [
  { id: 'station-hot', name: 'פס חם', createdAt: '2026-10-01' },
  { id: 'station-cold', name: 'פס קר', createdAt: '2026-10-01' },
];

describe('resolveStation', () => {
  it('keeps "all" and any station that still exists', () => {
    expect(resolveStation('all', stations)).toBe('all');
    expect(resolveStation('station-cold', stations)).toBe('station-cold');
  });

  it('keeps the built-in unassigned bucket, even with no stations at all', () => {
    expect(resolveStation('general', [])).toBe('general');
    expect(resolveStation('general', undefined)).toBe('general');
  });

  it('falls back to "all" for a station that was deleted', () => {
    expect(resolveStation('station-gone', stations)).toBe('all');
  });
});

// No jsdom in this repo: a minimal in-memory localStorage is all the module needs.
describe('stored station', () => {
  const data = new Map<string, string>();
  beforeEach(() => {
    data.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('defaults to "all"', () => {
    expect(readStoredStation()).toBe('all');
  });

  it('round-trips a station and clears itself for "all"', () => {
    writeStoredStation('station-hot');
    expect(data.get(TODAY_STATION_KEY)).toBe('station-hot');
    expect(readStoredStation()).toBe('station-hot');
    writeStoredStation('all');
    expect(data.has(TODAY_STATION_KEY)).toBe(false);
  });

  it('survives storage that throws', () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readStoredStation()).toBe('all');
    expect(() => writeStoredStation('station-hot')).not.toThrow();
  });
});
