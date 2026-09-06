import { describe, expect, it } from 'vitest';
import { initialSyncState, syncReduce } from '../engine';
import type { OpRow, SyncEffect, SyncState } from '../types';
import type { Action } from '../../store/reducer';
import type { AppState } from '../../types';

function baseState(overrides: Partial<AppState> = {}): AppState {
  return {
    schemaVersion: 3,
    settings: { defaultCoverageDays: 1, weekStartsOn: 0, roundMultiplierTo: 0.25 },
    cooks: [],
    ingredients: [{ id: 'ing-egg', name: 'ביצים', unit: 'unit', currentQty: 10, dailyUsage: 20, weeklyUsage: 140 }],
    products: [],
    recipes: [],
    tasks: [],
    taskOverrides: [],
    specialEvents: [],
    dayPlans: [],
    orderLines: [{ ingredientId: 'ing-egg', ordered: true }],
    ...overrides,
  };
}

const setQty = (qty: number): Action => ({ type: 'SET_INGREDIENT_QTY', id: 'ing-egg', qty });

function readyState(state: AppState = baseState()): SyncState {
  return { ...initialSyncState(state), ready: true, status: 'live' };
}

function dispatch(state: SyncState, opId: string, action: Action): [SyncState, SyncEffect[]] {
  return syncReduce(state, { type: 'DISPATCH', opId, action });
}

function effectsOfType<T extends SyncEffect['type']>(effects: SyncEffect[], type: T) {
  return effects.filter((e): e is Extract<SyncEffect, { type: T }> => e.type === type);
}

describe('DISPATCH', () => {
  it('applies optimistically to display immediately and queues an APPEND', () => {
    const [next, effects] = dispatch(readyState(), 'op-1', setQty(5));
    expect(next.display.ingredients[0].currentQty).toBe(5);
    expect(next.pending.map((p) => p.opId)).toEqual(['op-1']);
    expect(next.confirmed.ingredients[0].currentQty).toBe(10); // not yet confirmed
    const appends = effectsOfType(effects, 'APPEND');
    expect(appends).toHaveLength(1);
    expect(appends[0].ops.map((o) => o.opId)).toEqual(['op-1']);
  });

  it('a second dispatch while the first is still in flight is queued, not sent again', () => {
    const [afterFirst] = dispatch(readyState(), 'op-1', setQty(5));
    expect(afterFirst.inFlight).toEqual(['op-1']);
    const [afterSecond, effects] = dispatch(afterFirst, 'op-2', setQty(7));
    expect(afterSecond.pending.map((p) => p.opId)).toEqual(['op-1', 'op-2']);
    expect(afterSecond.display.ingredients[0].currentQty).toBe(7);
    expect(effectsOfType(effects, 'APPEND')).toHaveLength(0); // op-1 still in flight
  });

  it('offline: dispatch queues but never emits APPEND', () => {
    const offline: SyncState = { ...readyState(), online: false, status: 'offline' };
    const [next, effects] = dispatch(offline, 'op-1', setQty(5));
    expect(next.pending.map((p) => p.opId)).toEqual(['op-1']);
    expect(next.display.ingredients[0].currentQty).toBe(5); // still applied optimistically
    expect(effectsOfType(effects, 'APPEND')).toHaveLength(0);
  });
});

describe('ONLINE', () => {
  it('coming back online sends everything queued while offline, in original dispatch order', () => {
    let state: SyncState = { ...readyState(), online: false, status: 'offline' };
    [state] = dispatch(state, 'op-1', setQty(5));
    [state] = dispatch(state, 'op-2', { type: 'SET_INGREDIENT_PAR', id: 'ing-egg', parLevel: 2 });
    const [next, effects] = syncReduce(state, { type: 'ONLINE' });
    const appends = effectsOfType(effects, 'APPEND');
    expect(appends).toHaveLength(1);
    expect(appends[0].ops.map((o) => o.opId)).toEqual(['op-1', 'op-2']);
    expect(next.inFlight).toEqual(['op-1', 'op-2']);
  });
});

describe('APPEND_OK', () => {
  it('removes exactly the acknowledged opIds from pending and folds them into confirmed', () => {
    let state = readyState();
    [state] = dispatch(state, 'op-1', setQty(5));
    const rows: OpRow[] = [{ seq: 1, opId: 'op-1', action: setQty(5) }];
    const [next] = syncReduce(state, { type: 'APPEND_OK', rows });
    expect(next.pending).toEqual([]);
    expect(next.inFlight).toBeNull();
    expect(next.confirmed.ingredients[0].currentQty).toBe(5);
    expect(next.confirmedSeq).toBe(1);
    expect(next.display).toEqual(next.confirmed); // nothing left pending
  });

  it('an op echoed twice (append response and a later realtime push) is not applied twice', () => {
    let state = readyState();
    [state] = dispatch(state, 'op-1', setQty(5));
    const rows: OpRow[] = [{ seq: 1, opId: 'op-1', action: setQty(5) }];
    let [afterAppendOk] = syncReduce(state, { type: 'APPEND_OK', rows });
    const [afterEcho] = syncReduce(afterAppendOk, { type: 'OPS_IN', rows });
    expect(afterEcho.confirmed).toEqual(afterAppendOk.confirmed);
    expect(afterEcho.confirmedSeq).toBe(1);
  });

  it('a remote op arriving mid-pending: display reflects both, confirmed excludes pending', () => {
    let state = readyState();
    [state] = dispatch(state, 'op-1', setQty(5)); // our own optimistic change, still pending
    const remoteRow: OpRow[] = [
      { seq: 1, opId: 'remote-op', action: { type: 'SET_INGREDIENT_PAR', id: 'ing-egg', parLevel: 9 } },
    ];
    const [next] = syncReduce(state, { type: 'OPS_IN', rows: remoteRow });
    expect(next.confirmed.ingredients[0]).toMatchObject({ currentQty: 10, parLevel: 9 });
    expect(next.pending.map((p) => p.opId)).toEqual(['op-1']); // still pending, not confirmed
    expect(next.display.ingredients[0]).toMatchObject({ currentQty: 5, parLevel: 9 });
  });
});

describe('APPEND_ERR', () => {
  it('keeps pending, clears inFlight, sets status error, and schedules a retry', () => {
    let state = readyState();
    [state] = dispatch(state, 'op-1', setQty(5));
    const [next, effects] = syncReduce(state, { type: 'APPEND_ERR', opIds: ['op-1'], message: 'network down' });
    expect(next.pending.map((p) => p.opId)).toEqual(['op-1']);
    expect(next.inFlight).toBeNull();
    expect(next.status).toBe('error');
    expect(next.lastError).toBe('network down');
    expect(effectsOfType(effects, 'RETRY_IN')).toHaveLength(1);
  });

  it('RETRY resends the still-pending ops', () => {
    let state = readyState();
    [state] = dispatch(state, 'op-1', setQty(5));
    [state] = syncReduce(state, { type: 'APPEND_ERR', opIds: ['op-1'], message: 'x' });
    const [next, effects] = syncReduce(state, { type: 'RETRY' });
    expect(effectsOfType(effects, 'APPEND')[0].ops.map((o) => o.opId)).toEqual(['op-1']);
    expect(next.inFlight).toEqual(['op-1']);
  });
});

describe('gap detection triggers a resync', () => {
  it('OPS_IN with a missing seq applies the contiguous prefix and emits FETCH_OPS from there', () => {
    const state = readyState();
    const rows: OpRow[] = [
      { seq: 1, opId: 'a', action: setQty(3) },
      { seq: 3, opId: 'c', action: setQty(9) }, // seq 2 missing
    ];
    const [next, effects] = syncReduce(state, { type: 'OPS_IN', rows });
    expect(next.confirmedSeq).toBe(1);
    expect(next.confirmed.ingredients[0].currentQty).toBe(3);
    const fetches = effectsOfType(effects, 'FETCH_OPS');
    expect(fetches).toHaveLength(1);
    expect(fetches[0].sinceSeq).toBe(1);
  });
});

describe('SNAPSHOT_MOVED', () => {
  it('drops local pending state and re-bootstraps', () => {
    let state = readyState();
    [state] = dispatch(state, 'op-1', setQty(5));
    const [next, effects] = syncReduce(state, { type: 'SNAPSHOT_MOVED' });
    expect(next.pending).toEqual([]);
    expect(next.inFlight).toBeNull();
    expect(effectsOfType(effects, 'BOOTSTRAP')).toHaveLength(1);
  });
});

describe('HYDRATE', () => {
  it('with a cache: becomes ready synchronously and still schedules a reconciling BOOTSTRAP', () => {
    const cached = { confirmed: baseState({ ingredients: [] }), confirmedSeq: 4, pending: [] };
    const [next, effects] = syncReduce(initialSyncState(baseState()), { type: 'HYDRATE', cached });
    expect(next.ready).toBe(true);
    expect(next.confirmedSeq).toBe(4);
    expect(effectsOfType(effects, 'BOOTSTRAP')).toHaveLength(1);
  });

  it('with no cache: stays not-ready and only schedules BOOTSTRAP', () => {
    const [next, effects] = syncReduce(initialSyncState(baseState()), { type: 'HYDRATE', cached: undefined });
    expect(next.ready).toBe(false);
    expect(effects).toEqual([{ type: 'BOOTSTRAP' }]);
  });
});

describe('convergence: two clients with different pending, merged into one server order', () => {
  it('two clients that dispatched different local ops both converge once the server confirms both', () => {
    const seed = baseState({
      ingredients: [{ ...baseState().ingredients[0], currentQty: 50 }],
      orderLines: [{ ingredientId: 'ing-egg', ordered: true }],
    });

    // Two devices, each with its own optimistic queue built from the same starting point.
    let clientA = readyState(seed);
    [clientA] = dispatch(clientA, 'a-1', { type: 'SET_INGREDIENT_QTY', id: 'ing-egg', qty: 40 });
    [clientA] = dispatch(clientA, 'a-2', { type: 'SET_INGREDIENT_PAR', id: 'ing-egg', parLevel: 5 });

    let clientB = readyState(seed);
    const clientBReceipt: Action = { type: 'RECEIVE_ORDER', receipts: [{ ingredientId: 'ing-egg', qty: 8 }] };
    [clientB] = dispatch(clientB, 'b-1', clientBReceipt);

    // The server sees all three ops (from both devices) and assigns one total order.
    const serverOps: OpRow[] = [
      { seq: 1, opId: 'a-1', action: { type: 'SET_INGREDIENT_QTY', id: 'ing-egg', qty: 40 } },
      { seq: 2, opId: 'b-1', action: clientBReceipt },
      { seq: 3, opId: 'a-2', action: { type: 'SET_INGREDIENT_PAR', id: 'ing-egg', parLevel: 5 } },
    ];

    [clientA] = syncReduce(clientA, { type: 'OPS_IN', rows: serverOps });
    [clientB] = syncReduce(clientB, { type: 'OPS_IN', rows: serverOps });

    // Both devices' own optimistic ops are now confirmed, so nothing is left pending on either.
    expect(clientA.pending).toEqual([]);
    expect(clientB.pending).toEqual([]);
    expect(clientA.confirmed).toEqual(clientB.confirmed);
    expect(clientA.display).toEqual(clientB.display);
    // 50 -> 40 (A's set) -> +8 (B's receipt) — not 58, proving the set/receive interleaving
    // resolved the same way on both devices rather than one of them clobbering the other.
    expect(clientA.confirmed.ingredients[0]).toMatchObject({ currentQty: 48, parLevel: 5 });
  });

  it('property: replaying the same op sequence from the same base always converges', () => {
    const seed = baseState({ ingredients: [{ ...baseState().ingredients[0], currentQty: 20 }] });
    // Includes array-mutating ops (ADD_COOK/DELETE_COOK), not just field updates on one
    // ingredient — broadens coverage beyond scalar overwrites to ops whose result depends on
    // array order (append, then remove by id).
    const pool: Action[] = [
      { type: 'SET_INGREDIENT_QTY', id: 'ing-egg', qty: 12 },
      { type: 'SET_INGREDIENT_QTY', id: 'ing-egg', qty: 30 },
      { type: 'SET_INGREDIENT_PAR', id: 'ing-egg', parLevel: 4 },
      { type: 'RECEIVE_ORDER', receipts: [{ ingredientId: 'ing-egg', qty: 6 }] },
      { type: 'SET_ORDER_LINE_ORDERED', ingredientId: 'ing-egg', ordered: true },
      { type: 'SET_ORDER_LINE_ORDERED', ingredientId: 'ing-egg', ordered: false },
      { type: 'ADD_COOK', cook: { id: 'cook-x', name: 'טסט', color: '#000' } },
      { type: 'DELETE_COOK', id: 'cook-x' },
    ];

    let seedValue = 42;
    function nextRandom() {
      // Deterministic PRNG so a failure is reproducible without relying on a library.
      seedValue = (seedValue * 1103515245 + 12345) & 0x7fffffff;
      return seedValue / 0x7fffffff;
    }

    function shuffled<T>(items: T[]): T[] {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(nextRandom() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    }

    for (let trial = 0; trial < 500; trial++) {
      const length = 1 + Math.floor(nextRandom() * 10);
      const ops: OpRow[] = [];
      for (let i = 0; i < length; i++) {
        const action = pool[Math.floor(nextRandom() * pool.length)];
        ops.push({ seq: i + 1, opId: `op-${trial}-${i}`, action });
      }

      // Three delivery shapes must all land on the same confirmed state: one batch, one row at a
      // time, and a batch whose rows arrived out of seq order (as a realtime push legitimately
      // can) — foldContiguous is expected to sort by seq internally either way.
      let allAtOnce = initialSyncState(seed);
      [allAtOnce] = syncReduce(allAtOnce, { type: 'OPS_IN', rows: ops });

      let oneAtATime = initialSyncState(seed);
      for (const op of ops) {
        [oneAtATime] = syncReduce(oneAtATime, { type: 'OPS_IN', rows: [op] });
      }

      let outOfOrder = initialSyncState(seed);
      [outOfOrder] = syncReduce(outOfOrder, { type: 'OPS_IN', rows: shuffled(ops) });

      expect(oneAtATime.confirmed).toEqual(allAtOnce.confirmed);
      expect(oneAtATime.confirmedSeq).toBe(allAtOnce.confirmedSeq);
      expect(outOfOrder.confirmed).toEqual(allAtOnce.confirmed);
      expect(outOfOrder.confirmedSeq).toBe(allAtOnce.confirmedSeq);
    }
  });
});

describe('effects always include a PERSIST after any state-changing event', () => {
  it('DISPATCH persists the new pending queue', () => {
    const [, effects] = dispatch(readyState(), 'op-1', setQty(5));
    const persists = effectsOfType(effects, 'PERSIST');
    expect(persists).toHaveLength(1);
    expect(persists[0].value.pending.map((p) => p.opId)).toEqual(['op-1']);
  });
});

describe('schema version gate', () => {
  it('BOOTSTRAP_OK with a newer server schema than this client sets upgrade-required', () => {
    const [next] = syncReduce(initialSyncState(baseState()), {
      type: 'BOOTSTRAP_OK',
      confirmed: baseState(),
      confirmedSeq: 0,
      ops: [],
      serverSchemaVersion: 99,
    });
    expect(next.status).toBe('upgrade-required');
    expect(next.ready).toBe(true); // still renders the app, just stops sending writes
  });

  it('a matching (or older) server schema stays live', () => {
    const [next] = syncReduce(initialSyncState(baseState()), {
      type: 'BOOTSTRAP_OK',
      confirmed: baseState(),
      confirmedSeq: 0,
      ops: [],
      serverSchemaVersion: 3,
    });
    expect(next.status).toBe('live');
  });

  it('once set, later OPS_IN/ONLINE events cannot clear upgrade-required', () => {
    let state: SyncState = readyState();
    [state] = syncReduce(state, {
      type: 'BOOTSTRAP_OK',
      confirmed: baseState(),
      confirmedSeq: 0,
      ops: [],
      serverSchemaVersion: 99,
    });
    expect(state.status).toBe('upgrade-required');

    [state] = syncReduce(state, { type: 'OPS_IN', rows: [] });
    expect(state.status).toBe('upgrade-required');

    [state] = syncReduce({ ...state, online: false }, { type: 'ONLINE' });
    expect(state.status).toBe('upgrade-required');
  });

  it('a dispatched op still applies optimistically to display, but is never sent', () => {
    let state: SyncState = readyState();
    [state] = syncReduce(state, {
      type: 'BOOTSTRAP_OK',
      confirmed: baseState(),
      confirmedSeq: 0,
      ops: [],
      serverSchemaVersion: 99,
    });
    const [next, effects] = dispatch(state, 'op-1', setQty(5));
    expect(next.display.ingredients[0].currentQty).toBe(5);
    expect(effectsOfType(effects, 'APPEND')).toHaveLength(0);
  });
});

describe('retry backoff', () => {
  it('grows exponentially with each consecutive APPEND_ERR', () => {
    let state = readyState();
    [state] = dispatch(state, 'op-1', setQty(5));
    let effects: SyncEffect[];
    [state, effects] = syncReduce(state, { type: 'APPEND_ERR', opIds: ['op-1'], message: 'x' });
    expect(effectsOfType(effects, 'RETRY_IN')[0].ms).toBe(4000);
    expect(state.retryAttempt).toBe(1);

    [state] = syncReduce(state, { type: 'RETRY' });
    [state, effects] = syncReduce(state, { type: 'APPEND_ERR', opIds: ['op-1'], message: 'x' });
    expect(effectsOfType(effects, 'RETRY_IN')[0].ms).toBe(8000);
    expect(state.retryAttempt).toBe(2);
  });

  it('resets to 0 once an append actually succeeds', () => {
    let state = readyState();
    [state] = dispatch(state, 'op-1', setQty(5));
    [state] = syncReduce(state, { type: 'APPEND_ERR', opIds: ['op-1'], message: 'x' });
    expect(state.retryAttempt).toBe(1);

    const rows: OpRow[] = [{ seq: 1, opId: 'op-1', action: setQty(5) }];
    [state] = syncReduce(state, { type: 'APPEND_OK', rows });
    expect(state.retryAttempt).toBe(0);
  });
});

describe('append batching', () => {
  it('caps a single APPEND at 200 ops and sends the rest once those are confirmed', () => {
    let state = readyState();
    const opIds = Array.from({ length: 210 }, (_, i) => `op-${i}`);
    for (const opId of opIds) {
      [state] = dispatch(state, opId, setQty(1));
    }
    // The very first dispatch went out immediately (nothing in flight yet); every dispatch after
    // that just queues, since op-0's batch is still unconfirmed.
    expect(state.pending).toHaveLength(210);
    expect(state.inFlight).toEqual(['op-0']);

    const firstRows: OpRow[] = state.inFlight!.map((opId) => ({ seq: 1, opId, action: setQty(1) }));
    const [next, effects] = syncReduce(state, { type: 'APPEND_OK', rows: firstRows });
    expect(next.pending).toHaveLength(209);
    const appends = effectsOfType(effects, 'APPEND');
    expect(appends).toHaveLength(1);
    expect(appends[0].ops).toHaveLength(200); // capped, not all 209 remaining
  });
});

describe('OFFLINE / FOCUS', () => {
  it('OFFLINE flips online/status and never emits APPEND', () => {
    const [next, effects] = syncReduce(readyState(), { type: 'OFFLINE' });
    expect(next.online).toBe(false);
    expect(next.status).toBe('offline');
    expect(effects).toEqual([]);
  });

  it('FOCUS asks for anything since the last confirmed seq, only once ready', () => {
    const notReady = initialSyncState(baseState());
    expect(syncReduce(notReady, { type: 'FOCUS' })[1]).toEqual([]);

    const [, effects] = syncReduce(readyState(), { type: 'FOCUS' });
    expect(effects).toEqual([{ type: 'FETCH_OPS', sinceSeq: 0 }]);
  });
});

