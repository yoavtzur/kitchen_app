import { describe, expect, it } from 'vitest';
import { newId, newUuid } from '../ids';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('newId', () => {
  it('prefixes the id and keeps ids unique across calls', () => {
    const a = newId('ing');
    const b = newId('ing');
    expect(a.startsWith('ing-')).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe('newUuid', () => {
  // Regression test: an op's `opId` is sent to the `ops.op_id` column, which is typed `uuid` in
  // Postgres. `newId('op')` (a prefixed string like `op-<uuid>`) fails there with "invalid input
  // syntax for type uuid" — a real bug caught live against Supabase. newUuid() must always
  // produce a bare, valid UUID, never prefixed.
  it('produces a bare RFC 4122 v4 UUID with no prefix', () => {
    const id = newUuid();
    expect(id).toMatch(UUID_RE);
  });

  it('is unique across calls', () => {
    const a = newUuid();
    const b = newUuid();
    expect(a).not.toBe(b);
  });
});
