import { describe, expect, it } from 'vitest';
import { cookNameOf, validateJoinDetails } from '../cookName';

const ok = (first: string, last: string, phone = '') => validateJoinDetails({ first, last, phone });

describe('validateJoinDetails', () => {
  it('accepts two names and no phone', () => {
    expect(ok('יוסי', 'כהן')).toEqual({ ok: true, value: { first: 'יוסי', last: 'כהן' } });
  });

  it('tidies spacing, including inside a name', () => {
    expect(ok('  יוסי  ', ' בן   דוד ')).toEqual({ ok: true, value: { first: 'יוסי', last: 'בן דוד' } });
  });

  it('requires both names', () => {
    expect(ok('', 'כהן')).toMatchObject({ ok: false });
    expect(ok('יוסי', '   ')).toMatchObject({ ok: false });
  });

  it('caps a name at the server’s limit', () => {
    expect(ok('א'.repeat(40), 'ב')).toMatchObject({ ok: true });
    expect(ok('א'.repeat(41), 'ב')).toMatchObject({ ok: false });
  });

  it.each(['050-1234567', '+972 50 123 4567', '(03) 123-4567', '0501234567'])('accepts the phone %s', (phone) => {
    expect(ok('א', 'ב', phone)).toMatchObject({ ok: true, value: { phone } });
  });

  it.each(['abc', '12', '050-123-45-67-89-0000000', '050 1234567 ext 5'])('rejects the phone %s', (phone) => {
    expect(ok('א', 'ב', phone)).toMatchObject({ ok: false });
  });

  it('treats a blank phone as absent', () => {
    expect(ok('א', 'ב', '   ')).toEqual({ ok: true, value: { first: 'א', last: 'ב' } });
  });
});

describe('cookNameOf', () => {
  it('joins the two names with one space', () => {
    expect(cookNameOf('יוסי', 'כהן')).toBe('יוסי כהן');
    expect(cookNameOf(' יוסי ', ' כהן ')).toBe('יוסי כהן');
  });
});
