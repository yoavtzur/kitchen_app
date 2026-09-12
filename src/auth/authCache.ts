// A small localStorage cache of "who am I, at which restaurant" — separate from the sync
// engine's own persistence. Its whole purpose is offline resilience: a Supabase refresh token
// can fail to renew with no network, and a naive gate driven only by a live session check would
// then log a cook out mid-shift. Treating this cache as authoritative until an explicit
// SIGNED_OUT event means a cook who opened the app once stays "in" even if the network never
// cooperates again during that shift.
import type { MemberPermissions, MemberRole } from '../types';

export type CachedMembership = {
  restaurantId: string;
  restaurantName?: string;
  cookId: string | null;
  role: MemberRole;
} & MemberPermissions;

const KEY = 'kitchen-auth-membership';

/** Normalizes a cache blob written before granular roles existed: `owner`/`member` become
 * `chef`/`cook`, and missing permission flags default to false — a stale cook shouldn't
 * silently gain edit/delete rights just because their cached blob predates this field. */
function normalize(raw: unknown): CachedMembership | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.restaurantId !== 'string') return null;
  const legacyRole = r.role as string | undefined;
  const role: MemberRole = legacyRole === 'chef' || legacyRole === 'owner' ? 'chef' : 'cook';
  return {
    restaurantId: r.restaurantId,
    restaurantName: typeof r.restaurantName === 'string' ? r.restaurantName : undefined,
    cookId: typeof r.cookId === 'string' ? r.cookId : null,
    role,
    canEditRecipes: Boolean(r.canEditRecipes),
    canDeleteRecipes: Boolean(r.canDeleteRecipes),
  };
}

export function readCachedMembership(): CachedMembership | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function writeCachedMembership(membership: CachedMembership | null): void {
  try {
    if (membership) localStorage.setItem(KEY, JSON.stringify(membership));
    else localStorage.removeItem(KEY);
  } catch {
    // storage unavailable (private mode, quota) — silently skip, matching storage.ts's convention
  }
}
