// A no-network "backend" that behaves exactly like a single-tenant remote restaurant would: it
// holds the authoritative confirmed state and hands out seq numbers to appended ops, entirely in
// this tab. Used when no Supabase project is configured, so the app keeps working exactly as it
// always has — one device, no server — but through the same sync engine that will drive real
// multi-device sync, so that code path is exercised by every user, not just configured ones.
import { reducer } from '../store/reducer';
import { saveState } from '../store/storage';
import type { AppState } from '../types';
import type { OpRow, PendingOp, SyncAdapter } from './types';

export function createLocalAdapter(seed: AppState): SyncAdapter {
  let confirmed: AppState = seed;
  let seq = 0;

  return {
    async bootstrap() {
      // No server row to fall behind: the local schema version always matches whatever this
      // build's own state carries.
      return { confirmed, confirmedSeq: seq, ops: [], schemaVersion: confirmed.schemaVersion };
    },
    async appendOps(ops: PendingOp[]): Promise<OpRow[]> {
      const rows: OpRow[] = ops.map((op) => {
        seq += 1;
        confirmed = reducer(confirmed, op.action);
        return { seq, opId: op.opId, action: op.action };
      });
      // Keeps the existing kitchen-app-state key up to date, so Settings' export/import backup
      // and a future rollback to the pre-sync code both still see live data.
      saveState(confirmed);
      return rows;
    },
    async fetchOpsSince(): Promise<OpRow[]> {
      return []; // nothing else could have appended ops in a single local tab
    },
    subscribe() {
      return () => {}; // no remote push in local mode
    },
  };
}
