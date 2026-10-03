import type { MemberRole } from '../types';

/**
 * What a viewer may do to one row of the team list — the client's mirror of migration 0011's rules,
 * so a button is never offered that the server will refuse. The server is still the boundary.
 *
 *   • Any chef manages cooks: recipe permissions, removal.
 *   • Making or unmaking a chef, and removing one, is the owner's call.
 *   • Anyone but the owner may step down from chef by themselves, unless they are the last chef.
 *   • The owner is never removed or demoted; they hand ownership to another chef first.
 *   • No known owner (0011 not applied, `undefined`): every chef is equal, as before.
 *     An owner who is no longer a member (`null`, or absent from the list): any chef acts as owner.
 */
export type TeamRow = { userId: string; role: MemberRole };

export type RowControls = {
  isOwner: boolean;
  /** "שף" switch shown, and whether turning it on/off is allowed. */
  canMakeChef: boolean;
  canUnmakeChef: boolean;
  canRemove: boolean;
  canEditPermissions: boolean;
  canTransferOwnership: boolean;
};

export function actsAsOwner(
  viewerId: string | undefined,
  viewerIsChef: boolean,
  ownerId: string | null | undefined,
  members: TeamRow[],
): boolean {
  if (!viewerIsChef || !viewerId) return false;
  if (ownerId === undefined || ownerId === null) return true;
  if (ownerId === viewerId) return true;
  return !members.some((m) => m.userId === ownerId);
}

export function rowControls(
  row: TeamRow,
  viewerId: string | undefined,
  viewerIsChef: boolean,
  ownerId: string | null | undefined,
  members: TeamRow[],
): RowControls {
  const owner = actsAsOwner(viewerId, viewerIsChef, ownerId, members);
  const isMe = row.userId === viewerId;
  const isOwner = typeof ownerId === 'string' && row.userId === ownerId;
  const chefCount = members.filter((m) => m.role === 'chef').length;
  const isChefRow = row.role === 'chef';
  return {
    isOwner,
    canMakeChef: !isChefRow && !isMe && owner,
    canUnmakeChef: isChefRow && !isOwner && (isMe ? chefCount > 1 : owner),
    canRemove: !isMe && !isOwner && viewerIsChef && (isChefRow ? owner : true),
    canEditPermissions: viewerIsChef && !isChefRow,
    canTransferOwnership: ownerId !== undefined && owner && isChefRow && !isMe,
  };
}
