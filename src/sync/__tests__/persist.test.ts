import { describe, expect, it } from 'vitest';
import { memoryStore } from '../persist';

describe('memoryStore', () => {
  it('get returns null for a missing key', () => {
    const store = memoryStore();
    expect(store.get('nope')).toBeNull();
  });

  it('set then get round-trips a value', () => {
    const store = memoryStore();
    store.set('a', 'hello');
    expect(store.get('a')).toBe('hello');
  });

  it('accepts initial data', () => {
    const store = memoryStore({ seeded: 'yes' });
    expect(store.get('seeded')).toBe('yes');
  });

  it('two independently-constructed stores do not share state', () => {
    const a = memoryStore();
    const b = memoryStore();
    a.set('k', 'only-in-a');
    expect(b.get('k')).toBeNull();
  });
});
