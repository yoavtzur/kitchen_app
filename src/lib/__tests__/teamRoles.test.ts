import { describe, expect, it } from 'vitest';
import { actsAsOwner, rowControls, type TeamRow } from '../teamRoles';

const own: TeamRow = { userId: 'own', role: 'chef' };
const chef2: TeamRow = { userId: 'c2', role: 'chef' };
const cook: TeamRow = { userId: 'k', role: 'cook' };
const all = [own, chef2, cook];

describe('teamRoles', () => {
  it('the owner can make and unmake chefs and remove anyone but themselves', () => {
    expect(rowControls(cook, 'own', true, 'own', all)).toMatchObject({ canMakeChef: true, canRemove: true, canEditPermissions: true });
    expect(rowControls(chef2, 'own', true, 'own', all)).toMatchObject({
      canUnmakeChef: true,
      canRemove: true,
      canTransferOwnership: true,
    });
    expect(rowControls(own, 'own', true, 'own', all)).toMatchObject({ isOwner: true, canUnmakeChef: false, canRemove: false });
  });

  it('a second chef manages cooks only, and may step down', () => {
    expect(rowControls(cook, 'c2', true, 'own', all)).toMatchObject({ canMakeChef: false, canRemove: true, canEditPermissions: true });
    expect(rowControls(own, 'c2', true, 'own', all)).toMatchObject({ canUnmakeChef: false, canRemove: false, canTransferOwnership: false });
    expect(rowControls(chef2, 'c2', true, 'own', all)).toMatchObject({ canUnmakeChef: true, canRemove: false });
  });

  it('the last chef cannot step down', () => {
    expect(rowControls(own, 'own', true, null, [own, cook]).canUnmakeChef).toBe(false);
    expect(rowControls(chef2, 'c2', true, undefined, [chef2, cook]).canUnmakeChef).toBe(false);
  });

  it('a cook sees no controls', () => {
    const c = rowControls(chef2, 'k', false, 'own', all);
    expect(Object.values(c).filter(Boolean)).toEqual([]);
  });

  it('with no owner known every chef is equal, and nobody can transfer', () => {
    expect(actsAsOwner('c2', true, undefined, all)).toBe(true);
    expect(rowControls(cook, 'c2', true, undefined, all).canMakeChef).toBe(true);
    expect(rowControls(own, 'c2', true, undefined, all).canTransferOwnership).toBe(false);
  });

  it('an owner who left makes every chef act as owner', () => {
    expect(actsAsOwner('c2', true, 'gone', all)).toBe(true);
    expect(actsAsOwner('c2', true, null, all)).toBe(true);
    expect(actsAsOwner('c2', false, null, all)).toBe(false);
  });
});
