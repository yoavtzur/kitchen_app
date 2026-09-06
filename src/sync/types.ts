// Shared shapes for the sync engine. This file (like log.ts and engine.ts) must never import
// supabase.ts or any adapter — the whole protocol is exercised in node with zero mocks, and a
// mock or a real network client has no business leaking into the pure core.
import type { Action } from '../store/reducer';
import type { AppState } from '../types';

/** One action the "backend" (real or local-only) has accepted and assigned a position in the
 * log. Two clients that both see the same OpRow always apply the exact same effect. */
export type OpRow = {
  seq: number;
  opId: string;
  action: Action;
};

/** A locally-dispatched action not yet confirmed by the backend. */
export type PendingOp = {
  opId: string;
  action: Action;
};

export type SyncStatus = 'boot' | 'syncing' | 'live' | 'offline' | 'error' | 'upgrade-required';

export type SyncState = {
  /** The log applied up to and including `confirmedSeq`. Ops already folded in are discarded
   * immediately (there's nothing to gain by keeping them: `confirmed` already reflects them),
   * so this is always fully compacted rather than a separate base+ops pair. */
  confirmed: AppState;
  confirmedSeq: number;
  /** Locally-dispatched actions not yet confirmed, in dispatch order. */
  pending: PendingOp[];
  /** opIds of the batch currently being sent, or null if nothing is in flight. */
  inFlight: string[] | null;
  /** `confirmed` with `pending` replayed on top — what every screen actually reads. */
  display: AppState;
  status: SyncStatus;
  online: boolean;
  /** True once `display` reflects real data (a warm cache, or a completed bootstrap). Gates
   * whether AppProvider can render its children or must show a boot screen. */
  ready: boolean;
  lastError?: string;
  /** Consecutive APPEND failures since the last success, driving exponential backoff. Reset to 0
   * by anything that proves the connection works again (a fold from OPS_IN/APPEND_OK, ONLINE, or
   * a fresh BOOTSTRAP_OK). */
  retryAttempt: number;
};

/** What gets written to storage so a reload doesn't need to wait on the network. */
export type PersistedSync = {
  confirmed: AppState;
  confirmedSeq: number;
  pending: PendingOp[];
};

export type SyncEvent =
  | { type: 'HYDRATE'; cached: PersistedSync | undefined }
  | { type: 'BOOTSTRAP_OK'; confirmed: AppState; confirmedSeq: number; ops: OpRow[]; serverSchemaVersion: number }
  | { type: 'DISPATCH'; opId: string; action: Action }
  | { type: 'OPS_IN'; rows: OpRow[] }
  | { type: 'APPEND_OK'; rows: OpRow[] }
  | { type: 'APPEND_ERR'; opIds: string[]; message: string }
  | { type: 'RETRY' }
  | { type: 'SNAPSHOT_MOVED' }
  | { type: 'ONLINE' }
  | { type: 'OFFLINE' }
  | { type: 'FOCUS' };

export type SyncEffect =
  | { type: 'APPEND'; ops: PendingOp[] }
  | { type: 'FETCH_OPS'; sinceSeq: number }
  | { type: 'BOOTSTRAP' }
  | { type: 'PERSIST'; value: PersistedSync }
  | { type: 'RETRY_IN'; ms: number };

/** A swappable backend. `createLocalAdapter` (no network) and the future Supabase adapter both
 * implement this so the engine and store never know or care which one is behind them. */
export type SyncAdapter = {
  /** `schemaVersion` is the restaurant's own `schema_version` column, not `confirmed.schemaVersion`
   * (a field inside the snapshot blob) — kept separate so a stale client can tell "the *server*
   * has moved on to a shape I don't understand" from "the data I fetched says it's shape N",
   * which are usually the same number but conceptually different questions. */
  bootstrap(): Promise<{ confirmed: AppState; confirmedSeq: number; ops: OpRow[]; schemaVersion: number }>;
  appendOps(ops: PendingOp[]): Promise<OpRow[]>;
  fetchOpsSince(seq: number): Promise<OpRow[]>;
  /** Push channel for ops from other clients. Returns an unsubscribe function. A backend with
   * no such channel (the local adapter) can just return a no-op. */
  subscribe(onRows: (rows: OpRow[]) => void, onSnapshotMoved: () => void): () => void;
};
