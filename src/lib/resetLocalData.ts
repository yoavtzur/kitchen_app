// The three "get me out of this" escalations offered on the crash screen, and the honest
// accounting of what each one destroys.
//
// Everything this app stores lives under a `kitchen-` prefix in localStorage, but the keys are
// very far from equivalent — one is a session, one is an offline queue, and in local mode one
// of them is the kitchen's only copy of its entire database. So the tiers are ordered by how
// much they can cost, the cheapest one is the default, and the most expensive one is the only
// one that offers a download first.
import type { PersistedSync } from '../sync/types';

/** Local-mode AppState. In remote mode nothing reads this; in local mode it is *everything*. */
export const LOCAL_STATE_KEY = 'kitchen-app-state';
/** Per-restaurant sync cache: `{confirmed, confirmedSeq, pending}`. Dynamic key — enumerated. */
export const SYNC_KEY_PREFIX = 'kitchen-sync-';
/** Supabase's session store (see lib/supabase.ts `storageKey`). Clearing it signs the user out. */
export const AUTH_KEY = 'kitchen-auth';
/** Offline membership cache. Clearing it doesn't sign anyone out, but an *offline* user then
 * lands on Onboarding with no way to refill it until the network comes back. */
export const MEMBERSHIP_KEY = 'kitchen-auth-membership';
/** Debug escape hatch. Clearing it is harmless, and fixes the "why is my data empty" case where
 * someone flipped it on and forgot. */
export const FORCE_LOCAL_KEY = 'kitchen-force-local';
/** `ops.client_id`, debugging only. Regenerates on next use. */
export const DEVICE_KEY = 'kitchen-device-id';

const ALL_PREFIX = 'kitchen-';

function safeKeys(): string[] {
  try {
    return Object.keys(localStorage);
  } catch {
    return []; // storage unavailable (private mode) — matching storage.ts's convention
  }
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // nothing to do: if we can't remove it, we also can't have written it
  }
}

/** Every `kitchen-sync-<restaurantId>` key currently present. */
export function syncCacheKeys(): string[] {
  return safeKeys().filter((k) => k.startsWith(SYNC_KEY_PREFIX));
}

/**
 * How many locally-dispatched ops across every cached restaurant have not yet reached the
 * server. This is the number tier 2's confirmation has to show: it is exactly what clearing the
 * cache throws away, and "3 changes will be lost" is a decision a cook can make, while
 * "local cache" is not.
 */
export function unsentOpCount(): number {
  let total = 0;
  for (const key of syncCacheKeys()) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as PersistedSync;
      if (Array.isArray(parsed.pending)) total += parsed.pending.length;
    } catch {
      // A cache we can't parse is one we can't count; it's also one that clearing can only help.
    }
  }
  return total;
}

/** Whether there is any local-mode state at all — i.e. whether tier 3 would be destroying the
 * only copy of this kitchen's data rather than a cache of the server's. */
export function hasLocalOnlyState(): boolean {
  try {
    return localStorage.getItem(LOCAL_STATE_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Tier 1 — the safe default, and the one that actually fixes the common case.
 *
 * By far the most frequent cause of the screen the user is staring at is a stale bundle: an
 * index.html cached against JS chunks that no longer exist, or (once Phase 3 lands a service
 * worker) an outdated precache. Dropping the Cache Storage entries and asking any registered
 * worker to update, then reloading, resolves that without touching a single byte of data.
 */
export async function softReset(): Promise<void> {
  try {
    if (typeof caches !== 'undefined') {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    }
  } catch {
    // Cache Storage unavailable or blocked — the reload below is still worth doing.
  }
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
  } catch {
    // no worker registered yet (true until Phase 3), or update refused
  }
  reload();
}

/**
 * Tier 2 — the right default for a *synced* user: keeps the session, drops every per-restaurant
 * sync cache, and lets the engine re-bootstrap from the server on next load. Costs exactly the
 * unsent ops reported by `unsentOpCount()`; everything confirmed is still on the server.
 *
 * In local mode this is nearly a no-op (the local adapter's own key is `kitchen-app-state`,
 * which this does not touch) — which is correct: there is no server to re-bootstrap from.
 */
export async function clearSyncCaches(): Promise<void> {
  for (const key of syncCacheKeys()) safeRemove(key);
  await softReset();
}

/**
 * Tier 3 — everything. Signs out first (so Supabase gets a chance to revoke properly rather
 * than having its session yanked out from under it), then removes every `kitchen-` key.
 *
 * In local mode this destroys the kitchen's entire database with no server copy anywhere, which
 * is why the caller must offer a JSON download before reaching this function, and why the
 * confirm text says so outright. `hasLocalOnlyState()` is how the caller knows to.
 */
export async function fullReset(signOut?: () => Promise<void>): Promise<void> {
  try {
    await signOut?.();
  } catch {
    // Already signed out, or no network to tell the server — proceed regardless; the local
    // token is about to be removed either way.
  }
  for (const key of safeKeys()) {
    if (key.startsWith(ALL_PREFIX)) safeRemove(key);
  }
  await softReset();
}

/** Indirection so the crash screen's buttons stay unit-testable and so a single place decides
 * what "reload" means (a hash-preserving reload, not a navigation to `/`). */
function reload(): void {
  if (typeof window !== 'undefined') window.location.reload();
}
