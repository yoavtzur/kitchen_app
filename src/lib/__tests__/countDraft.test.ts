import { describe, expect, it } from 'vitest';
import {
  changesIn,
  draftSize,
  emptyDraft,
  movedSince,
  parseDraft,
  pruneMap,
  removeEntry,
  setEntry,
} from '../countDraft';

describe('countDraft', () => {
  it('parses only a draft for the same kitchen', () => {
    const raw = JSON.stringify({ scope: 'r1', ingredients: { a: { value: '3', base: 1 } }, products: {} });
    expect(parseDraft(raw, 'r1').ingredients.a).toEqual({ value: '3', base: 1 });
    expect(draftSize(parseDraft(raw, 'r2'))).toBe(0);
    expect(draftSize(parseDraft('not json', 'r1'))).toBe(0);
    expect(draftSize(parseDraft(null, 'r1'))).toBe(0);
  });

  it('drops malformed entries', () => {
    const raw = JSON.stringify({ scope: 'r', ingredients: { a: { value: 3 }, b: { value: '2', base: 0 } }, products: 5 });
    const d = parseDraft(raw, 'r');
    expect(Object.keys(d.ingredients)).toEqual(['b']);
    expect(d.products).toEqual({});
  });

  it('keeps the base from the first keystroke', () => {
    let m = setEntry({}, 'a', '1', 5);
    m = setEntry(m, 'a', '12', 7);
    expect(m.a).toEqual({ value: '12', base: 5 });
  });

  it('changesIn ignores unparseable and unchanged values', () => {
    const items = [
      { id: 'a', currentQty: 1 },
      { id: 'b', currentQty: 2 },
      { id: 'c', currentQty: 3 },
    ];
    const m = { a: { value: '4', base: 1 }, b: { value: '2', base: 2 }, c: { value: '', base: 3 } };
    expect(changesIn(m, items)).toEqual([{ id: 'a', qty: 4 }]);
  });

  it('flags rows whose stored quantity moved since typing', () => {
    const m = { a: { value: '4', base: 1 }, b: { value: '2', base: 2 } };
    expect([...movedSince(m, [{ id: 'a', currentQty: 9 }, { id: 'b', currentQty: 2 }])]).toEqual(['a']);
  });

  it('prunes deleted items and removes entries', () => {
    const m = { a: { value: '1', base: 0 }, gone: { value: '1', base: 0 } };
    expect(Object.keys(pruneMap(m, [{ id: 'a', currentQty: 0 }]))).toEqual(['a']);
    expect(removeEntry(m, 'a')).toEqual({ gone: m.gone });
    expect(removeEntry(m, 'zz')).toBe(m);
    expect(draftSize(emptyDraft('x'))).toBe(0);
  });
});
