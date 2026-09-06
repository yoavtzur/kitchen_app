// Retry timing, split in two on purpose: the exponential curve is deterministic (and lives here
// so engine.ts can emit an exact, testable `ms` for RETRY_IN), while jitter is random and is only
// ever applied by the imperative shell (store.ts) right before it schedules a real timer — mixing
// Math.random() into engine.ts would make its "pure protocol, zero mocks" tests non-reproducible
// for no benefit, since jitter only matters to avoid many real clients retrying in lockstep.
const BASE_MS = 4000;
const MAX_MS = 60_000;

/** attempt=1 -> BASE_MS, attempt=2 -> 2*BASE_MS, ... capped at MAX_MS. */
export function backoffMs(attempt: number): number {
  return Math.min(MAX_MS, BASE_MS * 2 ** Math.max(0, attempt - 1));
}

/** ±25% jitter around a delay that's about to be scheduled as a real timer. */
export function withJitter(ms: number): number {
  return Math.round(ms * (0.75 + Math.random() * 0.5));
}
