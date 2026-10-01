import { describe, expect, it } from 'vitest';
import { analyticsAllowed, createAnalytics, type AnalyticsDeps, type ConsentInputs } from '../analytics';

// The wire format is the guarantee here: this app's visible text is a restaurant's private data,
// so what may leave the device is pinned field by field, and a new field has to change this file.

function setup(overrides: Partial<AnalyticsDeps> = {}) {
  const sent: { url: string; body: { api_key: string; batch: Record<string, unknown>[] } }[] = [];
  let n = 0;
  const analytics = createAnalytics({
    apiKey: 'phc_test',
    host: 'https://eu.i.posthog.com',
    version: '1.2.3',
    now: () => new Date('2026-10-01T08:00:00.000Z'),
    newId: () => `id-${++n}`,
    send: (url, body) => sent.push({ url, body: JSON.parse(body) }),
    ...overrides,
  });
  return { analytics, sent };
}

describe('wire format', () => {
  it('sends an anonymous, geo-less event with exactly the expected fields', () => {
    const { analytics, sent } = setup();
    analytics.track({ name: 'screen_viewed', screen: 'orders' });
    analytics.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('https://eu.i.posthog.com/batch/');
    expect(sent[0].body.api_key).toBe('phc_test');
    expect(sent[0].body.batch).toEqual([
      {
        event: 'screen_viewed',
        distinct_id: 'id-1',
        timestamp: '2026-10-01T08:00:00.000Z',
        properties: {
          app_version: '1.2.3',
          $process_person_profile: false,
          $geoip_disable: true,
          $lib: 'kitchen-app',
          screen: 'orders',
        },
      },
    ]);
  });

  it('carries only the action type, never a payload', () => {
    const { analytics, sent } = setup();
    // A real dispatched action carries user data; trackAction is handed only its `type`.
    analytics.trackAction('CONFIRM_TASK_COMPLETION');
    analytics.flush();
    const props = sent[0].body.batch[0].properties as Record<string, unknown>;
    expect(props.type).toBe('CONFIRM_TASK_COMPLETION');
    expect(Object.keys(props).sort()).toEqual(
      ['$geoip_disable', '$lib', '$process_person_profile', 'app_version', 'type'].sort(),
    );
  });

  it('uses one in-memory id for the whole page load', () => {
    const { analytics, sent } = setup();
    analytics.track({ name: 'app_opened', standalone: false });
    analytics.track({ name: 'screen_viewed', screen: 'tasks' });
    analytics.flush();
    const ids = sent[0].body.batch.map((e) => e.distinct_id);
    expect(new Set(ids).size).toBe(1);
  });
});

describe('the action allowlist', () => {
  it('ignores action types that are not on it', () => {
    const { analytics, sent } = setup();
    analytics.trackAction('SET_INGREDIENT_QTY');
    analytics.trackAction('UPDATE_SETTINGS');
    analytics.trackAction('IMPORT_STATE');
    analytics.flush();
    expect(sent).toHaveLength(0);
  });

  it('reports the core-loop actions', () => {
    const { analytics, sent } = setup();
    analytics.trackAction('SUBMIT_ORDER');
    analytics.trackAction('BULK_UPDATE_QUANTITIES');
    analytics.flush();
    expect(sent[0].body.batch.map((e) => (e.properties as { type: string }).type)).toEqual([
      'SUBMIT_ORDER',
      'BULK_UPDATE_QUANTITIES',
    ]);
  });
});

describe('batching', () => {
  it('sends nothing when there is nothing queued', () => {
    const { analytics, sent } = setup();
    analytics.flush();
    expect(sent).toHaveLength(0);
  });

  it('flushes on its own at 20 events and empties the queue', () => {
    const { analytics, sent } = setup();
    for (let i = 0; i < 20; i++) analytics.track({ name: 'screen_viewed', screen: 'tasks' });
    expect(sent).toHaveLength(1);
    expect(sent[0].body.batch).toHaveLength(20);
    analytics.flush();
    expect(sent).toHaveLength(1);
  });

  it('survives a send that throws, and drops rather than retries', () => {
    let calls = 0;
    const { analytics } = setup({
      send: () => {
        calls++;
        throw new Error('network down');
      },
    });
    analytics.track({ name: 'screen_viewed', screen: 'tasks' });
    expect(() => analytics.flush()).not.toThrow();
    analytics.flush();
    expect(calls).toBe(1);
  });
});

describe('analyticsAllowed', () => {
  const ok: ConsentInputs = {
    configured: true,
    remote: true,
    optedOut: false,
    doNotTrack: false,
    globalPrivacyControl: false,
  };

  it('is on only when every input is favourable', () => {
    expect(analyticsAllowed(ok)).toBe(true);
  });

  it.each([
    ['no key configured', { configured: false }],
    ['local mode', { remote: false }],
    ['the person opted out', { optedOut: true }],
    ['Do Not Track', { doNotTrack: true }],
    ['Global Privacy Control', { globalPrivacyControl: true }],
  ])('is off for %s', (_label, change) => {
    expect(analyticsAllowed({ ...ok, ...change })).toBe(false);
  });
});
