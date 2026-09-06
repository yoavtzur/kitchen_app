// The only file in the app that imports supabase-js for data (not auth). Implements SyncAdapter
// against the schema in supabase/migrations/0001_init.sql: a `snapshots` row plus an `ops` log,
// both scoped to one restaurant, written only through the append_ops RPC.
import { supabase } from '../lib/supabase';
import type { Action } from '../store/reducer';
import type { AppState } from '../types';
import type { OpRow, PendingOp, SyncAdapter } from './types';

type OpRowDb = { seq: number; op_id: string; action: Action };

function toOpRow(row: OpRowDb): OpRow {
  return { seq: row.seq, opId: row.op_id, action: row.action };
}

function describeError(error: { message: string; code?: string }): string {
  return error.code ? `${error.message} (${error.code})` : error.message;
}

export function createSupabaseAdapter(restaurantId: string, clientId: string): SyncAdapter {
  if (!supabase) throw new Error('Supabase is not configured');
  const client = supabase;

  return {
    async bootstrap() {
      const [snapResult, restaurantResult] = await Promise.all([
        client.from('snapshots').select('seq, state').eq('restaurant_id', restaurantId).single(),
        client.from('restaurants').select('schema_version').eq('id', restaurantId).single(),
      ]);
      const { data: snap, error: snapErr } = snapResult;
      if (snapErr) throw new Error(describeError(snapErr));
      const { data: restaurant, error: restaurantErr } = restaurantResult;
      if (restaurantErr) throw new Error(describeError(restaurantErr));

      const { data: ops, error: opsErr } = await client
        .from('ops')
        .select('seq, op_id, action')
        .eq('restaurant_id', restaurantId)
        .gt('seq', snap.seq)
        .order('seq');
      if (opsErr) throw new Error(describeError(opsErr));

      return {
        confirmed: snap.state as AppState,
        confirmedSeq: snap.seq as number,
        ops: (ops ?? []).map((row) => toOpRow(row as OpRowDb)),
        schemaVersion: restaurant.schema_version as number,
      };
    },

    async appendOps(ops: PendingOp[]): Promise<OpRow[]> {
      const { data, error } = await client.rpc('append_ops', {
        p_restaurant_id: restaurantId,
        p_client_id: clientId,
        p_ops: ops.map((op) => ({ op_id: op.opId, action: op.action })),
      });
      if (error) throw new Error(describeError(error));
      return ((data ?? []) as OpRowDb[]).map(toOpRow);
    },

    async fetchOpsSince(seq: number): Promise<OpRow[]> {
      const { data, error } = await client
        .from('ops')
        .select('seq, op_id, action')
        .eq('restaurant_id', restaurantId)
        .gt('seq', seq)
        .order('seq');
      if (error) throw new Error(describeError(error));
      return ((data ?? []) as OpRowDb[]).map(toOpRow);
    },

    subscribe(onRows, onSnapshotMoved) {
      // Tracks the last snapshot_seq we've seen so an unrelated `restaurants` update (e.g. a
      // future rename feature) doesn't trigger a needless re-bootstrap. Known limitation: if
      // this tab is disconnected across an entire reset_snapshot (JSON-backup import), the old
      // ops it deletes make a plain fetchOpsSince look like "nothing new" instead of "stale" —
      // a rare, deliberate admin action, not worth the extra machinery to close for v1.
      let knownSnapshotSeq: number | null = null;

      const channel = client
        .channel(`restaurant-${restaurantId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'ops', filter: `restaurant_id=eq.${restaurantId}` },
          (payload) => onRows([toOpRow(payload.new as OpRowDb)]),
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'restaurants', filter: `id=eq.${restaurantId}` },
          (payload) => {
            const next = (payload.new as { snapshot_seq: number }).snapshot_seq;
            if (knownSnapshotSeq !== null && next !== knownSnapshotSeq) onSnapshotMoved();
            knownSnapshotSeq = next;
          },
        )
        .subscribe();

      return () => {
        client.removeChannel(channel);
      };
    },
  };
}
