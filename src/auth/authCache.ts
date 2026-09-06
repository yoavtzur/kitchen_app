// A small localStorage cache of "who am I, at which restaurant" — separate from the sync
// engine's own persistence. Its whole purpose is offline resilience: a Supabase refresh token
// can fail to renew with no network, and a naive gate driven only by a live session check would
// then log a cook out mid-shift. Treating this cache as authoritative until an explicit
// SIGNED_OUT event means a cook who opened the app once stays "in" even if the network never
// cooperates again during that shift.
export type CachedMembership = {
  restaurantId: string;
  cookId: string | null;
  role: 'owner' | 'member';
};

const KEY = 'kitchen-auth-membership';

export function readCachedMembership(): CachedMembership | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as CachedMembership) : null;
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
