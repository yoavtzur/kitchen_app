import { describe, expect, it } from 'vitest';
import { mapRpcError } from '../rpcErrors';

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
    ['P0003', 'too_many_join_attempts', 'יותר מדי ניסיונות'],
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
