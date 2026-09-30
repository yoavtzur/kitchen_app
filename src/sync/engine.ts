// The whole sync protocol as one pure function: syncReduce(state, event) -> [state, effects].
// Like log.ts, this never imports supabase.ts or any adapter, so it's exercised directly in
// node with zero mocks; store.ts is the only place that actually runs an effect.
import type { AppState } from '../types';
import { SCHEMA_VERSION } from '../data/seed';
import { ensureStations } from '../lib/migrateStations';
import { backoffMs } from './backoff';
import { applyPending, foldContiguous } from './log';
import type { OpRow, PendingOp, PersistedSync, SyncEffect, SyncEvent, SyncState, SyncStatus } from './types';

const MAX_APPEND_BATCH = 200; // append_ops rejects a batch bigger than this server-side

/**
 * Statuses that suppress outbound appends.
 *
 * One predicate rather than the comparisons that used to be repeated at four sites: the fourth
 * is exactly where a second blocking status would have been forgotten. Reads and incoming ops
 * keep working in both — only sending stops.
 */
export function isBlocked(status: SyncStatus): boolean {
  return status === 'upgrade-required' || status === 'read-only';
}

/** The status to settle on once the connection has proved itself. A blocking status survives,
 * because neither kind is fixed by more ops arriving; anything else becomes 'live'. */
function healthyStatus(state: SyncState): SyncStatus {
  return isBlocked(state.status) ? state.status : 'live';
}

export function initialSyncState(seed: AppState): SyncState {
  return {
    confirmed: seed,
    confirmedSeq: 0,
    pending: [],
    inFlight: null,
    display: seed,
    status: 'boot',
    online: true,
    ready: false,
    retryAttempt: 0,
  };
}

function withDisplay(state: SyncState): SyncState {
  return { ...state, display: applyPending(state.confirmed, state.pending.map((p) => p.action)) };
}

function toPersisted(state: SyncState): PersistedSync {
  return { confirmed: state.confirmed, confirmedSeq: state.confirmedSeq, pending: state.pending };
}

/** Starts sending the pending queue (capped at MAX_APPEND_BATCH — a bigger queue is sent in
 * successive batches, one per round trip, since each batch's own APPEND_OK clears inFlight and
 * lets settle() call this again) if nothing is already in flight, we're online, ready, not stuck
 * behind a stale schema, and there's something to send. */
function maybeAppend(state: SyncState): { state: SyncState; effect?: SyncEffect } {
  if (
    state.inFlight !== null ||
    !state.online ||
    !state.ready ||
    isBlocked(state.status) ||
    state.pending.length === 0
  ) {
    return { state };
  }
  const batch = state.pending.slice(0, MAX_APPEND_BATCH);
  return {
    state: { ...state, inFlight: batch.map((p) => p.opId) },
    effect: { type: 'APPEND', ops: batch },
  };
}

/** Folds newly-seen rows (from a bootstrap, a fetch, a realtime push, or our own append coming
 * back) into `confirmed`, dropping any pending op that just got confirmed. */
function foldAndSettle(state: SyncState, rows: readonly OpRow[]): { state: SyncState; gap: boolean } {
  const { state: confirmed, toSeq, appliedOpIds, gap } = foldContiguous(state.confirmed, state.confirmedSeq, rows);
  const applied = new Set(appliedOpIds);
  const pending = state.pending.filter((p) => !applied.has(p.opId));
  const inFlight = state.inFlight ? state.inFlight.filter((id) => !applied.has(id)) : state.inFlight;
  return {
    state: {
      ...state,
      confirmed,
      confirmedSeq: toSeq,
      pending,
      inFlight: inFlight && inFlight.length > 0 ? inFlight : null,
    },
    gap,
  };
}

/** Common tail for every branch that may have new pending/confirmed data: recompute `display`,
 * decide whether to start sending, and always persist the result. */
function settle(state: SyncState, extraEffects: SyncEffect[] = []): [SyncState, SyncEffect[]] {
  const displayed = withDisplay(state);
  const { state: withAppend, effect } = maybeAppend(displayed);
  const effects = [...extraEffects];
  if (effect) effects.push(effect);
  effects.push({ type: 'PERSIST', value: toPersisted(withAppend) });
  return [withAppend, effects];
}

export function syncReduce(state: SyncState, event: SyncEvent): [SyncState, SyncEffect[]] {
  switch (event.type) {
    case 'HYDRATE': {
      if (!event.cached) return [state, [{ type: 'BOOTSTRAP' }]];
      // The cached blob is whatever a previous version of the app last persisted, which for
      // anyone who used the app before per-kitchen stations shipped has no `stations` key at
      // all — and HYDRATE renders immediately, well before BOOTSTRAP's network round trip could
      // ever normalize it. See ensureStations's own comment for the full picture.
      const next: SyncState = {
        ...state,
        confirmed: ensureStations(event.cached.confirmed),
        confirmedSeq: event.cached.confirmedSeq,
        pending: event.cached.pending,
        ready: true,
        status: 'syncing',
      };
      const [settled, effects] = settle(next);
      return [settled, [...effects, { type: 'BOOTSTRAP' }]];
    }

    case 'BOOTSTRAP_OK': {
      const { state: folded } = foldAndSettle(
        { ...state, confirmed: event.confirmed, confirmedSeq: event.confirmedSeq },
        event.ops,
      );
      // A client built against an older schema than the restaurant has moved to can't safely
      // interpret (or write) the current shape — surface "please refresh" and stop sending local
      // writes (see the status check in maybeAppend) rather than risk corrupting the op log.
      // There's no way back to 'live' short of a reload picking up a rebuilt client.
      const upgradeRequired = event.serverSchemaVersion > SCHEMA_VERSION;
      // A bootstrap that lands while writes are switched off must not quietly switch them back
      // on — the config says read-only until the config says otherwise.
      return settle({
        ...folded,
        ready: true,
        status: upgradeRequired ? 'upgrade-required' : healthyStatus(state),
        lastError: undefined,
        retryAttempt: 0,
      });
    }

    case 'DISPATCH': {
      const pending: PendingOp[] = [...state.pending, { opId: event.opId, action: event.action }];
      return settle({ ...state, pending });
    }

    case 'OPS_IN':
    case 'APPEND_OK': {
      const { state: folded, gap } = foldAndSettle(state, event.rows);
      const status = folded.ready ? healthyStatus(state) : folded.status;
      const withStatus: SyncState = { ...folded, status, lastError: undefined, retryAttempt: 0 };
      const extra: SyncEffect[] = gap ? [{ type: 'FETCH_OPS', sinceSeq: folded.confirmedSeq }] : [];
      return settle(withStatus, extra);
    }

    case 'APPEND_ERR': {
      const failedIds = new Set(event.opIds);
      const inFlight = state.inFlight ? state.inFlight.filter((id) => !failedIds.has(id)) : null;
      // A permanent error (e.g. the server rejected the op as forbidden) can never be fixed by
      // retrying — keeping it in `pending` forever would jam the queue behind it, silently
      // blocking every op dispatched afterward. Drop it and recompute `display` so the UI stops
      // reflecting the rejected change, instead of scheduling a RETRY_IN.
      if (event.permanent) {
        const pending = state.pending.filter((p) => !failedIds.has(p.opId));
        const dropped: SyncState = {
          ...state,
          pending,
          inFlight: inFlight && inFlight.length > 0 ? inFlight : null,
          status: 'error',
          lastError: event.message,
        };
        return settle(dropped);
      }
      const retryAttempt = state.retryAttempt + 1;
      const next: SyncState = {
        ...state,
        inFlight: inFlight && inFlight.length > 0 ? inFlight : null,
        status: 'error',
        lastError: event.message,
        retryAttempt,
      };
      return [next, [{ type: 'RETRY_IN', ms: backoffMs(retryAttempt) }]];
    }

    case 'SET_READ_ONLY': {
      // Never clobbers 'upgrade-required'. That one means this build cannot safely interpret the
      // server's schema, which no config flag can make untrue — and a config read saying "writes
      // are fine" must not talk a stale client back into appending.
      if (state.status === 'upgrade-required') return [state, []];
      if (event.readOnly) {
        return state.status === 'read-only' ? [state, []] : [{ ...state, status: 'read-only' }, []];
      }
      if (state.status !== 'read-only') return [state, []];
      // Coming back: pick the status that describes reality now, then flush whatever the cook
      // queued up while writes were off.
      const status: SyncStatus = !state.online ? 'offline' : state.ready ? 'live' : 'syncing';
      const { state: withAppend, effect } = maybeAppend({ ...state, status });
      return [withAppend, effect ? [effect] : []];
    }

    case 'RETRY': {
      const { state: withAppend, effect } = maybeAppend(state);
      return [withAppend, effect ? [effect] : []];
    }

    case 'SNAPSHOT_MOVED': {
      // The server's snapshot moved out from under us (an import/reset elsewhere) — anything
      // optimistic built on the old base is stale. Drop it and re-bootstrap from scratch.
      const next: SyncState = { ...state, pending: [], inFlight: null, status: 'syncing' };
      return [withDisplay(next), [{ type: 'BOOTSTRAP' }]];
    }

    case 'ONLINE': {
      const status = state.ready ? healthyStatus(state) : state.status;
      const next: SyncState = { ...state, online: true, status, retryAttempt: 0 };
      const { state: withAppend, effect } = maybeAppend(next);
      return [withAppend, effect ? [effect] : []];
    }

    case 'OFFLINE':
      return [{ ...state, online: false, status: 'offline' }, []];

    case 'FOCUS':
      return [state, state.ready ? [{ type: 'FETCH_OPS', sinceSeq: state.confirmedSeq }] : []];

    default:
      return [state, []];
  }
}
