import { describe, expect, it } from 'vitest';
import { mapInviteStatus, mapRequestJoinStatus, mapRpcError } from '../rpcErrors';

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

describe('mapRpcError, invites and join requests', () => {
  it('does not call a request that was already answered a missing code', () => {
    expect(mapRpcError({ code: 'P0002', message: 'no_such_request' })).toBe('הבקשה כבר טופלה');
    expect(mapRpcError({ code: 'P0002', message: 'invalid_code' })).toBe('קוד לא נמצא');
  });

  it('explains the cap on open invitations', () => {
    expect(mapRpcError({ code: '54000', message: 'too_many_invites' })).toContain('הזמנות פתוחות');
  });
});

describe('mapRequestJoinStatus', () => {
  it('reports no error only for a recorded request', () => {
    expect(mapRequestJoinStatus('pending')).toBeNull();
  });

  it.each([
    ['invalid_code', 'קוד לא נמצא'],
    ['invalid_invite', 'קישור חדש'],
    ['invalid_name', 'שם פרטי'],
    ['already_member', 'כבר משויך'],
    ['full', 'יותר מדי בקשות'],
    ['rate_limited', 'יותר מדי ניסיונות'],
  ])('maps %s', (status, expected) => {
    expect(mapRequestJoinStatus(status)).toContain(expected);
  });

  it('treats an unrecognised status as a refusal, not as a request that was recorded', () => {
    expect(mapRequestJoinStatus('something_new')).toBeTruthy();
    expect(mapRequestJoinStatus('ok')).toBeTruthy();
    expect(mapRequestJoinStatus(undefined)).toBeTruthy();
    expect(mapRequestJoinStatus(null)).toBeTruthy();
  });
});

describe('mapInviteStatus', () => {
  it('lets a valid link through', () => {
    expect(mapInviteStatus('valid')).toBeNull();
  });

  it('says what is wrong with an unusable link, and always points to the chef', () => {
    for (const status of ['expired', 'used', 'invalid', 'whatever']) {
      expect(mapInviteStatus(status)).toContain('מהשף');
    }
    expect(mapInviteStatus('expired')).toContain('פג');
    expect(mapInviteStatus('used')).toContain('נוצל');
  });
});
