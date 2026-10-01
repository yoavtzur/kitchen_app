import { describe, expect, it } from 'vitest';
import { savedMessage, syncIndicator } from '../syncIndicator';
import type { SyncStatus } from '../../sync/types';

const info = (status: SyncStatus, pendingCount = 0, stalePendingMinutes?: number) => ({
  status,
  pendingCount,
  stalePendingMinutes,
});

describe('syncIndicator', () => {
  it('shows nothing while healthy', () => {
    expect(syncIndicator(info('live'))).toEqual({ kind: 'none' });
  });

  it('is a grey dot when offline with nothing waiting', () => {
    expect(syncIndicator(info('offline'))).toMatchObject({ kind: 'dot', tone: 'gray' });
  });

  it('is an amber dot when offline with changes waiting, and says how many', () => {
    const r = syncIndicator(info('offline', 3));
    expect(r).toMatchObject({ kind: 'dot', tone: 'amber' });
    expect(r.kind === 'dot' && r.label).toContain('3');
  });

  it('is an amber dot while sending', () => {
    expect(syncIndicator(info('syncing', 2))).toMatchObject({ kind: 'dot', tone: 'amber' });
    expect(syncIndicator(info('live', 2))).toMatchObject({ kind: 'dot', tone: 'amber' });
  });

  it('is a quiet grey dot while connecting', () => {
    expect(syncIndicator(info('boot'))).toMatchObject({ kind: 'dot', tone: 'gray' });
  });

  it('never uses red for a dot: red is reserved for words that need a person', () => {
    const states: SyncStatus[] = ['boot', 'syncing', 'live', 'offline'];
    for (const status of states) {
      for (const pending of [0, 5]) {
        const r = syncIndicator(info(status, pending));
        if (r.kind === 'dot') expect(r.tone).not.toBe('red');
      }
    }
  });

  it('escalates the actionable states to a pill with words', () => {
    expect(syncIndicator(info('upgrade-required'))).toMatchObject({ kind: 'pill', tone: 'red' });
    expect(syncIndicator(info('error'))).toMatchObject({ kind: 'pill', tone: 'red' });
    expect(syncIndicator(info('read-only'))).toMatchObject({ kind: 'pill', tone: 'yellow' });
  });

  it('lets upgrade-required win over a stuck queue', () => {
    expect(syncIndicator(info('upgrade-required', 4, 30))).toMatchObject({ label: 'יש לרענן את האפליקציה' });
  });

  it('escalates a queue stuck for minutes even while status looks busy', () => {
    const r = syncIndicator(info('syncing', 4, 12));
    expect(r).toMatchObject({ kind: 'pill', tone: 'red' });
    expect(r.kind === 'pill' && r.label).toContain('12');
  });

  it('tells read-only apart from upgrade-required, so one is never mistaken for the other', () => {
    const ro = syncIndicator(info('read-only'));
    const up = syncIndicator(info('upgrade-required'));
    expect(ro.kind === 'pill' && ro.label).not.toBe(up.kind === 'pill' && up.label);
  });
});

describe('savedMessage', () => {
  it('confirms plainly when connected', () => {
    expect(savedMessage({ status: 'live', online: true }, true)).toBe('נשמר ✓');
  });

  it('says the save is on the device when there is no connection', () => {
    expect(savedMessage({ status: 'offline', online: false }, true)).toContain('במכשיר');
    expect(savedMessage({ status: 'live', online: false }, true)).toContain('במכשיר');
  });

  it('never talks about syncing in local mode, where there is nothing to sync with', () => {
    expect(savedMessage({ status: 'offline', online: false }, false)).toBe('נשמר ✓');
  });
});
