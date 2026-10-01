import { describe, expect, it } from 'vitest';
import { mapJoinStatus, mapRpcError } from '../rpcErrors';

describe('mapRpcError', () => {
  it('tells the last chef to appoint a replacement rather than that they cannot be demoted', () => {
    // `last_chef_account` contains `last_chef`, so a naive ordering answers the wrong question:
    // the chef is trying to delete their account, not change their own role.
    expect(mapRpcError({ code: '42501', message: 'last_chef_account' })).toContain('מחיקת החשבון');
  });

  it('still maps the demotion guard it shadows', () => {
    expect(mapRpcError({ code: '42501', message: 'last_chef' })).toContain('מתפקידו');
  });

  it.each([
    ['P0002', 'invalid_code', 'קוד לא נמצא'],
    ['23505', 'duplicate key', 'כבר משויך'],
    ['42501', 'chef_only', 'רק שף'],
    ['42501', 'cannot_remove_self', 'לא ניתן להסיר את עצמך'],
    ['42501', 'something else entirely', 'אין הרשאה'],
  ])('maps %s/%s', (code, message, expected) => {
    expect(mapRpcError({ code, message })).toContain(expected);
  });

  it('names the missing migration rather than showing PostgREST schema-cache wording', () => {
    const mapped = mapRpcError({
      code: 'PGRST202',
      message: 'Could not find the function public.delete_my_account in the schema cache',
    });
    expect(mapped).not.toContain('schema cache');
    expect(mapped).toContain('מסד הנתונים');
  });

  it('passes an unrecognised error through unchanged rather than inventing a reason', () => {
    expect(mapRpcError({ code: 'XX000', message: 'boom' })).toBe('boom');
    expect(mapRpcError({ message: 'no code at all' })).toBe('no code at all');
  });
});

describe('mapJoinStatus', () => {
  const RID = '11111111-1111-1111-1111-111111111111';

  it('reports no error for a successful join', () => {
    expect(mapJoinStatus('ok', RID)).toBeNull();
  });

  it.each([
    ['invalid_code', 'קוד לא נמצא'],
    ['rate_limited', 'יותר מדי ניסיונות'],
  ])('maps %s', (status, expected) => {
    expect(mapJoinStatus(status, null)).toContain(expected);
  });

  it('treats an unrecognised status as a refusal, not a success', () => {
    // A server newer than this build. The one thing we know is that it did not say 'ok', and
    // reading it as success would write a membership with no restaurant id.
    expect(mapJoinStatus('something_new', RID)).toBeTruthy();
    expect(mapJoinStatus('', RID)).toBeTruthy();
  });

  describe('against a server without migration 0007', () => {
    // There is no `status` column there, and merging to main deploys before the migration is
    // pasted in by hand — so this window is real, not hypothetical.
    it('accepts a row with a real restaurant id as the success it is', () => {
      expect(mapJoinStatus(undefined, RID)).toBeNull();
      expect(mapJoinStatus(null, RID)).toBeNull();
    });

    it('still refuses when there is no restaurant id to join', () => {
      expect(mapJoinStatus(undefined, null)).toBeTruthy();
      expect(mapJoinStatus(undefined, undefined)).toBeTruthy();
      expect(mapJoinStatus(undefined, '')).toBeTruthy();
    });
  });
});
