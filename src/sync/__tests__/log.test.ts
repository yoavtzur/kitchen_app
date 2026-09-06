import { describe, expect, it } from 'vitest';
import { applyOps, applyPending, contiguousPrefix, foldContiguous } from '../log';
import type { OpRow } from '../types';
import type { AppState } from '../../types';

function baseState(overrides: Partial<AppState> = {}): AppState {
  return {
    schemaVersion: 3,
    settings: { defaultCoverageDays: 1, weekStartsOn: 0, roundMultiplierTo: 0.25 },
    cooks: [],
    ingredients: [{ id: 'ing-egg', name: 'ביצים', unit: 'unit', currentQty: 60, dailyUsage: 20, weeklyUsage: 140 }],
    products: [],
    recipes: [],
    tasks: [],
    taskOverrides: [],
    specialEvents: [],
    dayPlans: [],
    orderLines: [],
    ...overrides,
  };
}

function receiveOp(seq: number, qty: number, opId = `op-${seq}`, ingredientId = 'ing-egg'): OpRow {
  return { seq, opId, action: { type: 'RECEIVE_ORDER', receipts: [{ ingredientId, qty }] } };
}

describe('applyOps', () => {
  it('applies ops in the given order and is deterministic', () => {
    const state = baseState({ orderLines: [{ ingredientId: 'ing-egg', ordered: true }] });
    const ops = [receiveOp(1, 5)];
    const once = applyOps(state, ops);
    const again = applyOps(state, ops);
    expect(once.ingredients[0].currentQty).toBe(65);
    expect(again).toEqual(once);
  });

  it('empty ops list is a no-op', () => {
    const state = baseState();
    expect(applyOps(state, [])).toEqual(state);
  });
});

describe('applyPending', () => {
  it('replays pending actions on top of confirmed state', () => {
    const confirmed = baseState();
    const next = applyPending(confirmed, [
      { type: 'SET_INGREDIENT_QTY', id: 'ing-egg', qty: 12 },
      { type: 'SET_INGREDIENT_PAR', id: 'ing-egg', parLevel: 3 },
    ]);
    expect(next.ingredients[0]).toMatchObject({ currentQty: 12, parLevel: 3 });
  });
});

describe('contiguousPrefix', () => {
  it('returns rows in order when they extend fromSeq with no gaps', () => {
    const rows = [receiveOp(2, 1), receiveOp(1, 1), receiveOp(3, 1)]; // deliberately out of order
    const prefix = contiguousPrefix(0, rows);
    expect(prefix.map((r) => r.seq)).toEqual([1, 2, 3]);
  });

  it('stops at the first missing seq', () => {
    const rows = [receiveOp(1, 1), receiveOp(3, 1)]; // seq 2 missing
    const prefix = contiguousPrefix(0, rows);
    expect(prefix.map((r) => r.seq)).toEqual([1]);
  });

  it('ignores rows at or before fromSeq (already applied)', () => {
    const rows = [receiveOp(1, 1), receiveOp(2, 1)];
    expect(contiguousPrefix(2, rows)).toEqual([]);
  });

  it('drops an exact duplicate at the same seq, keeping one copy', () => {
    const rows = [receiveOp(1, 1, 'op-a'), receiveOp(1, 1, 'op-a')];
    const prefix = contiguousPrefix(0, rows);
    expect(prefix).toHaveLength(1);
  });
});

describe('foldContiguous', () => {
  it('applies the contiguous prefix and reports the new seq', () => {
    const state = baseState({
      ingredients: [
        { id: 'ing-egg', name: 'ביצים', unit: 'unit', currentQty: 60, dailyUsage: 20, weeklyUsage: 140 },
        { id: 'ing-flour', name: 'קמח', unit: 'kg', currentQty: 5, dailyUsage: 2, weeklyUsage: 14 },
      ],
      orderLines: [
        { ingredientId: 'ing-egg', ordered: true },
        { ingredientId: 'ing-flour', ordered: true },
      ],
    });
    const result = foldContiguous(state, 0, [receiveOp(1, 5), receiveOp(2, 3, 'op-2', 'ing-flour')]);
    expect(result.state.ingredients.find((i) => i.id === 'ing-egg')?.currentQty).toBe(65);
    expect(result.state.ingredients.find((i) => i.id === 'ing-flour')?.currentQty).toBe(8);
    expect(result.toSeq).toBe(2);
    expect(result.appliedOpIds).toEqual(['op-1', 'op-2']);
    expect(result.gap).toBe(false);
  });

  it('flags a gap and only applies up to it', () => {
    const state = baseState({ orderLines: [{ ingredientId: 'ing-egg', ordered: true }] });
    const result = foldContiguous(state, 0, [receiveOp(1, 5), receiveOp(3, 3)]); // seq 2 missing
    expect(result.state.ingredients[0].currentQty).toBe(65); // only seq 1 applied
    expect(result.toSeq).toBe(1);
    expect(result.gap).toBe(true);
  });

  it('rows already covered by fromSeq are ignored, not re-applied', () => {
    const state = baseState();
    const result = foldContiguous(state, 5, [receiveOp(3, 5), receiveOp(4, 5)]);
    expect(result.state).toEqual(state);
    expect(result.toSeq).toBe(5);
    expect(result.gap).toBe(false);
  });
});
