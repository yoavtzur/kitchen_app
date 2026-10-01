// Product analytics — and, more to the point, the allowlist that makes it safe to switch on.
//
// Every visible string in this app is a restaurant's private data (ingredient, recipe, cook and
// task names). PostHog's own SDK is built to capture exactly that: `autocapture` records the
// text of every element a person clicks (`$el_text`), and it also brings session recording,
// automatic pageviews with full URLs, a persistent cookie, feature-flag polling and lazily
// loaded third-party scripts. Each is individually switchable and every one defaults the wrong
// way for this app.
//
// So there is no SDK here. This file speaks to PostHog's capture endpoint directly and can send
// exactly three things, each built from a closed type — which is the same inversion `sentry.ts`
// makes for crash reports: nothing leaves unless it is explicitly allowed out.
//
//   • `app_opened`     the app started (once per page load)
//   • `screen_viewed`  which screen, by route *name* from `routes.tsx` — never a pathname
//   • `action`         a dispatched `Action['type']`, from the short list below — never a payload
//
// There is no free-form property anywhere, and no function in this module takes a `string` that
// a caller could fill with user content: the types below do the refusing, and `analytics.test.ts`
// pins the wire format so a field can't be added without a test changing.
//
// **Dormant, in three independent ways** (`analyticsAllowed`): no `VITE_POSTHOG_KEY`; local mode
// (CLAUDE.md promises that mode has no network at all, and an analytics ping would break that);
// or the person said no — the Settings toggle, or the browser's own Do Not Track / Global
// Privacy Control signal, which is honoured with no UI at all.
//
// **No identifier is stored on the device.** `distinct_id` is a random id held in memory for one
// page load: no cookie, no localStorage entry, so no consent banner is owed for it. The cost is
// that a returning cook counts as a new visitor each launch — "how many people use this" is not
// answerable, "which screens and actions are used" is, and the second is the question this exists
// for. Events carry `$process_person_profile: false` (no person record is created, which also
// makes them cheaper) and `$geoip_disable: true`.
import type { Action } from '../store/reducer';
import { ANALYTICS_OPT_OUT_KEY } from './resetLocalData';

/** Every action type that may be reported. A `Set` of the *type* literals only; the payload of an
 * action is never read. Chosen as the core loop — completing prep, counting, ordering — because
 * "is the thing the app is for being done" is the whole question. Typed against `Action['type']`
 * so a rename in the reducer is a compile error here rather than a silently dead entry. */
const TRACKED_ACTIONS: ReadonlySet<Action['type']> = new Set<Action['type']>([
  'CONFIRM_TASK_COMPLETION',
  'CONFIRM_AUTO_TASK_COMPLETION',
  'UNDO_TASK_COMPLETION',
  'UNDO_AUTO_TASK_COMPLETION',
  'ADD_TASK',
  'BULK_UPDATE_QUANTITIES',
  'SUBMIT_ORDER',
  'RECEIVE_ORDER',
  'ADD_RECIPE',
  'SAVE_PREP_ITEM',
]);

export type AnalyticsEvent =
  | { name: 'app_opened'; standalone: boolean }
  | { name: 'screen_viewed'; screen: string }
  | { name: 'action'; type: Action['type'] };

type WireEvent = {
  event: string;
  distinct_id: string;
  timestamp: string;
  properties: Record<string, string | boolean>;
};

/** What `createAnalytics` needs from the outside world — injected so the whole module is testable
 * in node, with no network and no clock. */
export type AnalyticsDeps = {
  apiKey: string;
  /** Capture host, no trailing slash. Must be in `connect-src` in `vercel.json`. */
  host: string;
  version: string;
  now: () => Date;
  newId: () => string;
  /** Fire-and-forget. Never throws, never retries: analytics is lossy by design, and a retry
   * loop is a thing that can wedge a phone on bad kitchen wifi. */
  send: (url: string, body: string) => void;
};

export type Analytics = {
  track: (event: AnalyticsEvent) => void;
  /** Reports a dispatched action iff its type is on the allowlist. */
  trackAction: (type: Action['type']) => void;
  flush: () => void;
};

const MAX_BATCH = 20;
/** A hard cap so a runaway loop cannot grow memory without bound. Oldest is dropped. */
const MAX_QUEUE = 100;

export function createAnalytics(deps: AnalyticsDeps): Analytics {
  const distinctId = deps.newId();
  let queue: WireEvent[] = [];

  function toWire(event: AnalyticsEvent): WireEvent {
    // Built field by field from the closed union, never by spreading the event in: a property
    // added to `AnalyticsEvent` later must be added here on purpose to reach the wire.
    const properties: WireEvent['properties'] = {
      app_version: deps.version,
      $process_person_profile: false,
      $geoip_disable: true,
      $lib: 'kitchen-app',
    };
    if (event.name === 'app_opened') properties.standalone = event.standalone;
    if (event.name === 'screen_viewed') properties.screen = event.screen;
    if (event.name === 'action') properties.type = event.type;
    return {
      event: event.name,
      distinct_id: distinctId,
      timestamp: deps.now().toISOString(),
      properties,
    };
  }

  function flush(): void {
    if (queue.length === 0) return;
    const batch = queue;
    queue = [];
    try {
      deps.send(`${deps.host}/batch/`, JSON.stringify({ api_key: deps.apiKey, batch }));
    } catch {
      // Dropped on purpose — see `AnalyticsDeps.send`.
    }
  }

  function track(event: AnalyticsEvent): void {
    queue.push(toWire(event));
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
    if (queue.length >= MAX_BATCH) flush();
  }

  function trackAction(type: Action['type']): void {
    if (TRACKED_ACTIONS.has(type)) track({ name: 'action', type });
  }

  return { track, trackAction, flush };
}

// --- consent ------------------------------------------------------------------------------

export type ConsentInputs = {
  /** `VITE_POSTHOG_KEY` is set. */
  configured: boolean;
  /** Supabase mode. Local mode promises no network, so it never reports. */
  remote: boolean;
  optedOut: boolean;
  /** `navigator.doNotTrack === '1'` */
  doNotTrack: boolean;
  /** `navigator.globalPrivacyControl === true` */
  globalPrivacyControl: boolean;
};

/** The single decision. Every input has to be favourable; any one unfavourable input silences
 * the module entirely. Pure, so the table of cases is in `analytics.test.ts`. */
export function analyticsAllowed(c: ConsentInputs): boolean {
  return c.configured && c.remote && !c.optedOut && !c.doNotTrack && !c.globalPrivacyControl;
}

export function isOptedOut(): boolean {
  try {
    return localStorage.getItem(ANALYTICS_OPT_OUT_KEY) === '1';
  } catch {
    return false; // storage unavailable: nothing could have been stored, so nothing was refused
  }
}

export function setOptedOut(optedOut: boolean): void {
  try {
    if (optedOut) localStorage.setItem(ANALYTICS_OPT_OUT_KEY, '1');
    else localStorage.removeItem(ANALYTICS_OPT_OUT_KEY);
  } catch {
    // see isOptedOut
  }
  // Takes effect immediately, in this page load: drop what is queued, and stop recording.
  if (optedOut && instance) {
    instance = null;
  } else if (!optedOut) {
    initAnalytics();
  }
}

// --- the runtime singleton ----------------------------------------------------------------
//
// Everything above is pure. This is the only part that touches `navigator`, `fetch`, timers and
// `document`, and it is deliberately thin.

const DEFAULT_HOST = 'https://eu.i.posthog.com';

let instance: Analytics | null = null;
let flushTimer: ReturnType<typeof setInterval> | undefined;
let listenersInstalled = false;

function readConsentInputs(remote: boolean): ConsentInputs {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return {
    configured: Boolean(import.meta.env.VITE_POSTHOG_KEY),
    remote,
    optedOut: isOptedOut(),
    doNotTrack: nav.doNotTrack === '1',
    globalPrivacyControl: nav.globalPrivacyControl === true,
  };
}

/** Whether Settings should offer the toggle at all: false when analytics could never run here
 * regardless of what the person chooses, so the control isn't a lie about something inert. */
export function analyticsAvailable(remote: boolean): boolean {
  return Boolean(import.meta.env.VITE_POSTHOG_KEY) && remote;
}

let remoteMode = false;

/**
 * Starts reporting if every consent input allows it. Idempotent. Returns whether it is running.
 * `remote` is passed in rather than imported so this module doesn't pull in the Supabase client.
 */
export function initAnalytics(remote?: boolean): boolean {
  if (remote !== undefined) remoteMode = remote;
  if (instance) return true;
  if (!analyticsAllowed(readConsentInputs(remoteMode))) return false;

  instance = createAnalytics({
    apiKey: import.meta.env.VITE_POSTHOG_KEY as string,
    host: (import.meta.env.VITE_POSTHOG_HOST ?? DEFAULT_HOST).replace(/\/+$/, ''),
    version: import.meta.env.VITE_APP_VERSION ?? 'dev',
    now: () => new Date(),
    newId: () => crypto.randomUUID(),
    // `text/plain` keeps this a CORS "simple request" (no preflight round trip), which PostHog's
    // capture endpoint accepts for exactly this reason. `keepalive` lets a flush on page-hide
    // outlive the page.
    send: (url, body) => {
      void fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'text/plain' }, keepalive: true }).catch(
        () => {},
      );
    },
  });

  if (!listenersInstalled) {
    listenersInstalled = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') instance?.flush();
    });
    window.addEventListener('pagehide', () => instance?.flush());
  }
  flushTimer ??= setInterval(() => instance?.flush(), 15_000);

  const standalone = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  instance.track({ name: 'app_opened', standalone });
  return true;
}

/** No-ops while dormant, so call sites need no guard. */
export function track(event: AnalyticsEvent): void {
  instance?.track(event);
}

export function trackAction(type: Action['type']): void {
  instance?.trackAction(type);
}
