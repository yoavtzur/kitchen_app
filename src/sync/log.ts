// Pure log/state-folding helpers. Never import supabase.ts or any adapter — these are exercised
// directly in node with zero mocks, and engine.ts builds the whole sync protocol out of them.
import { reducer, type Action } from '../store/reducer';
import type { AppState } from '../types';
import type { OpRow } from './types';

/** Applies ops (in ascending seq order, with no gaps assumed) on top of a base state. */
export function applyOps(base: AppState, ops: readonly OpRow[]): AppState {
  return ops.reduce((state, op) => reducer(state, op.action), base);
}

/** Applies locally-pending actions (in dispatch order) on top of the confirmed state — this is
 * `display`, what every screen actually reads through useApp(). */
export function applyPending(confirmed: AppState, pendingActions: readonly Action[]): AppState {
  return pendingActions.reduce((state, action) => reducer(state, action), confirmed);
}

/** The rows from `rows` that extend `fromSeq` one-by-one with no missing seq in between, in
 * order. Rows beyond the first gap are left out entirely — the caller should re-fetch from the
 * end of the returned prefix rather than guess at what's missing. */
export function contiguousPrefix(fromSeq: number, rows: readonly OpRow[]): OpRow[] {
  const bySeq = new Map(rows.map((r) => [r.seq, r] as const));
  const prefix: OpRow[] = [];
  let seq = fromSeq;
  while (bySeq.has(seq + 1)) {
    const row = bySeq.get(seq + 1);
    if (!row) break;
    prefix.push(row);
    seq += 1;
  }
  return prefix;
}

/**
 * Folds as much of `rows` as is contiguous starting right after `fromSeq` into `state`, applying
 * each op via the reducer in seq order. `gap` is true when some row in `rows` sits beyond the
 * contiguous run (out of order, or a seq was skipped) — realtime delivery can do either, and
 * correctness comes from re-fetching from `toSeq`, not from trying to buffer and reorder here.
 */
export function foldContiguous(
  state: AppState,
  fromSeq: number,
  rows: readonly OpRow[],
): { state: AppState; toSeq: number; appliedOpIds: string[]; gap: boolean } {
  const prefix = contiguousPrefix(fromSeq, rows);
  const toSeq = fromSeq + prefix.length;
  const gap = rows.some((r) => r.seq > toSeq);
  return {
    state: applyOps(state, prefix),
    toSeq,
    appliedOpIds: prefix.map((r) => r.opId),
    gap,
  };
}
