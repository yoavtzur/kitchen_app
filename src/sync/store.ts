// The imperative shell: runs the effects the pure engine asks for, and exposes a React-friendly
// subscribe/getSnapshot pair. Nothing in here contains sync *logic* — that all lives in engine.ts
// and log.ts; this file only ever calls out to an adapter or a KVStore.
import { newUuid } from '../lib/ids';
import { createSeedState } from '../data/seed';
import type { Action } from '../store/reducer';
import { loadState } from '../store/storage';
import type { AppState } from '../types';
import { backoffMs, withJitter } from './backoff';
import { initialSyncState, syncReduce } from './engine';
import { createLocalAdapter } from './localAdapter';
import type { KVStore } from './persist';
import type { SyncAdapter, SyncEffect, SyncEvent, SyncState, SyncStatus } from './types';

// How long the oldest still-unsent op has to sit in `pending` before the UI escalates from "sync
// status" to an explicit stuck-queue warning — long enough that a normal retry cycle (seconds)
// never trips it, short enough that a cook notices well within a shift.
const STALE_PENDING_MS = 10 * 60 * 1000;
const STALE_CHECK_INTERVAL_MS = 30_000;

export type SyncInfo = {
  status: SyncStatus;
  pendingCount: number;
  online: boolean;
  lastError?: string;
  /** Set once the oldest unsent op has been queued for longer than STALE_PENDING_MS — a stronger
   * signal than `status` alone, since retries can keep looking "busy" indefinitely while nothing
   * actually reaches the server (e.g. a captive portal that answers every request with junk). */
  stalePendingMinutes?: number;
};

export type SyncStore = {
  subscribe(cb: () => void): () => void;
  getState(): SyncState;
  getSyncInfo(): SyncInfo;
  dispatch(action: Action): void;
};

/**
 * Builds a store around a pre-existing initial SyncState. `kv`/`storageKey` are optional: when
 * given, `HYDRATE` is dispatched immediately from whatever's cached there, and every PERSIST
 * effect writes back to it — this is what lets a remote-mode reload skip the boot screen. Local
 * mode passes neither: its adapter already starts `ready` and persists itself (see localAdapter).
 */
function createSyncStore(adapter: SyncAdapter, initial: SyncState, kv?: KVStore, storageKey?: string): SyncStore {
  let state = initial;
  // Wall-clock companion to `state.pending`, deliberately kept outside the pure SyncState: it's
  // UI telemetry ("how long has this been stuck"), not something sync correctness depends on, so
  // it doesn't need to survive a reload or be replayed in engine.test.ts.
  let pendingSince: number | null = null;
  let staleCheckTimer: ReturnType<typeof setInterval> | null = null;
  let syncInfo = computeSyncInfo();
  const listeners = new Set<() => void>();

  function emit() {
    for (const listener of listeners) listener();
  }

  function computeSyncInfo(): SyncInfo {
    const base: SyncInfo = {
      status: state.status,
      pendingCount: state.pending.length,
      online: state.online,
      lastError: state.lastError,
    };
    if (pendingSince === null) return base;
    const ageMs = Date.now() - pendingSince;
    return ageMs >= STALE_PENDING_MS ? { ...base, stalePendingMinutes: Math.floor(ageMs / 60_000) } : base;
  }

  /** Starts/stops the wall-clock timer the instant `pending` goes empty<->non-empty, and (while
   * running) ticks `emit()` periodically so a viewer watching the badge sees the stuck duration
   * climb even though nothing about the sync state itself changed since the last real event. */
  function trackPendingSince() {
    if (state.pending.length > 0) {
      if (pendingSince === null) pendingSince = Date.now();
      if (!staleCheckTimer) {
        staleCheckTimer = setInterval(() => {
          syncInfo = computeSyncInfo();
          emit();
        }, STALE_CHECK_INTERVAL_MS);
      }
    } else {
      pendingSince = null;
      if (staleCheckTimer) {
        clearInterval(staleCheckTimer);
        staleCheckTimer = null;
      }
    }
  }

  function apply(event: SyncEvent) {
    const [next, effects] = syncReduce(state, event);
    state = next;
    trackPendingSince();
    syncInfo = computeSyncInfo();
    for (const effect of effects) runEffect(effect);
    emit();
  }

  function runEffect(effect: SyncEffect) {
    switch (effect.type) {
      case 'PERSIST':
        if (kv && storageKey) kv.set(storageKey, JSON.stringify(effect.value));
        return;
      case 'APPEND':
        adapter.appendOps(effect.ops).then(
          (rows) => apply({ type: 'APPEND_OK', rows }),
          (err: unknown) =>
            apply({ type: 'APPEND_ERR', opIds: effect.ops.map((o) => o.opId), message: String(err) }),
        );
        return;
      case 'FETCH_OPS': {
        // Retries itself with exponential backoff + jitter, entirely outside SyncState — unlike
        // APPEND_ERR, a failed fetch doesn't affect what's pending (nothing was lost, we just
        // don't yet know what's new), so there's nothing here for engine.ts to react to.
        const attemptFetch = (attempt: number) => {
          adapter.fetchOpsSince(effect.sinceSeq).then(
            (rows) => apply({ type: 'OPS_IN', rows }),
            () => setTimeout(() => attemptFetch(attempt + 1), withJitter(backoffMs(attempt + 1))),
          );
        };
        attemptFetch(0);
        return;
      }
      case 'BOOTSTRAP':
        adapter.bootstrap().then(({ confirmed, confirmedSeq, ops, schemaVersion }) =>
          apply({ type: 'BOOTSTRAP_OK', confirmed, confirmedSeq, ops, serverSchemaVersion: schemaVersion }),
        );
        return;
      case 'RETRY_IN':
        setTimeout(() => apply({ type: 'RETRY' }), withJitter(effect.ms));
        return;
    }
  }

  adapter.subscribe(
    (rows) => apply({ type: 'OPS_IN', rows }),
    () => apply({ type: 'SNAPSHOT_MOVED' }),
  );

  // Realtime is a latency optimization, not the correctness mechanism (see engine.ts) — these
  // three triggers are what actually guarantee we notice a missed update. Only wired for a real
  // backend (kv+storageKey present): local mode has no network to reconnect to. The store is a
  // page-lifetime singleton (see getSyncStore below), so these listeners are never torn down —
  // that's fine, there's nothing to leak them into once the page itself goes away.
  if (kv && storageKey && typeof window !== 'undefined') {
    window.addEventListener('online', () => apply({ type: 'ONLINE' }));
    window.addEventListener('offline', () => apply({ type: 'OFFLINE' }));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') apply({ type: 'FOCUS' });
    });
  }

  if (kv && storageKey) {
    const raw = kv.get(storageKey);
    apply({ type: 'HYDRATE', cached: raw ? JSON.parse(raw) : undefined });
  }

  return {
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getState: () => state,
    getSyncInfo: () => syncInfo,
    dispatch(action) {
      apply({ type: 'DISPATCH', opId: newUuid(), action });
    },
  };
}

/** The store used when no backend is configured: synchronously ready from the very first render
 * (no boot screen, ever), backed by the existing localStorage state exactly as before. */
export function createLocalSyncStore(): SyncStore {
  const seed: AppState = loadState();
  const adapter = createLocalAdapter(seed);
  const initial: SyncState = { ...initialSyncState(seed), ready: true, status: 'live' };
  return createSyncStore(adapter, initial);
}

/** For a real backend (Phase 4): starts in `boot` and follows the full hydrate-then-bootstrap
 * protocol, so a returning device can render instantly from cache while it reconciles online.
 * The seed passed here is just a placeholder shape until HYDRATE or BOOTSTRAP_OK replace it —
 * `ready` stays false (AppProvider shows a boot screen) until one of those actually lands, so
 * its content is never shown. */
export function createRemoteSyncStore(adapter: SyncAdapter, kv: KVStore, storageKey: string): SyncStore {
  const online = typeof navigator === 'undefined' || navigator.onLine;
  const initial: SyncState = { ...initialSyncState(createSeedState()), online };
  return createSyncStore(adapter, initial, kv, storageKey);
}

// One store per key, surviving StrictMode's double render/effect invocation by construction —
// there is no useEffect here to double-run, just a module-level map a component looks up.
const stores = new Map<string, SyncStore>();

export function getSyncStore(key: string, factory: () => SyncStore): SyncStore {
  let store = stores.get(key);
  if (!store) {
    store = factory();
    stores.set(key, store);
  }
  return store;
}
