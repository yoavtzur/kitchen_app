// Crash reporting, and — more importantly — the scrubbing that makes it safe to switch on.
//
// This app's *entire* content is user data: ingredient names, recipe names, cook names, task
// titles, supplier names. A default Sentry install would ship a meaningful slice of a
// restaurant's private operating data to a third party. So the rule here is inverted from the
// usual one: nothing leaves this file unless it is explicitly allowed out.
//
// Dormant with no DSN. `initSentry()` returns false, no client is created, and every other
// export degrades to a no-op — so this module is safe to call from anywhere without a guard,
// and the app behaves exactly as it did before Sentry existed.
import * as Sentry from '@sentry/react';

/** Version of this build, for tagging. Phase 6 replaces this with a real injected value. */
const CLIENT_VERSION = import.meta.env.VITE_APP_VERSION ?? 'dev';

// --- scrubbing ----------------------------------------------------------------------------

/** `Key (name)=(פטרוזיליה)` — Postgres quotes the offending value into unique-violation and
 * foreign-key messages, which supabaseAdapter.ts turns into an AppendError.message, engine.ts
 * stores as SyncState.lastError, and Settings.tsx renders. A live leak path, not a theoretical
 * one. */
const PG_KEY_DETAIL = /Key \([^)]*\)=\([^)]*\)/g;

/** Any Hebrew text at all: one Hebrew character, or a run that starts and ends on one with
 * spaces/quotes/hyphens allowed in between (so a multi-word name collapses to a single marker
 * rather than three).
 *
 * Deliberately blunt: *every* user-entered value in this app is Hebrew, and no runtime error
 * message from React, the browser, Supabase or Postgres ever is. This also redacts the app's
 * own Hebrew UI strings when they appear in a message — an acceptable loss, since the stack
 * frame identifies the site anyway, and a denylist of "known safe" Hebrew would rot. The
 * minimum is one character, not three: a two-letter ingredient name is still an ingredient
 * name, and there is nothing on the other side of the trade to protect. */
const HEBREW_RUN = /[\u0590-\u05FF](?:[\u0590-\u05FF\s"'-]*[\u0590-\u05FF])?/gu;

/** Only ever used as a base to make `new URL` accept a relative path; recognized afterwards so
 * it never appears in a report. */
const RELATIVE_BASE = 'https://relative.invalid';

const EMAIL_LIKE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const UUID_LIKE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/**
 * Removes user content from a free-text string bound for Sentry. Order matters: the Postgres
 * detail is collapsed first (so its parentheses survive as a recognizable shape), then the
 * broad Hebrew sweep, then the identifier shapes.
 *
 * Exported for `sentry.test.ts`, which is the actual guarantee here — the scrubber is only as
 * good as its test table.
 */
export function scrubText(input: string): string {
  return input
    .replace(PG_KEY_DETAIL, 'Key (…)=(…)')
    .replace(HEBREW_RUN, '[he]')
    .replace(EMAIL_LIKE, '[email]')
    .replace(UUID_LIKE, '[uuid]');
}

function scrubMaybe(value: unknown): string | undefined {
  return typeof value === 'string' ? scrubText(value) : undefined;
}

/**
 * Strips an event down to what we are willing to send, then scrubs what's left.
 *
 * Structurally an allowlist, not a denylist: `extra` and `contexts.state` are deleted outright
 * rather than filtered, because both grow — a denylist over a growing op log loses eventually,
 * and it loses silently.
 *
 * Exported for tests; `initSentry` wires it as `beforeSend`.
 */
export function sanitizeEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  delete event.extra;
  if (event.contexts) delete event.contexts.state;
  delete event.user;

  const message = scrubMaybe(event.message);
  if (message !== undefined) event.message = message;

  for (const value of event.exception?.values ?? []) {
    const scrubbed = scrubMaybe(value.value);
    if (scrubbed !== undefined) value.value = scrubbed;
  }

  for (const crumb of event.breadcrumbs ?? []) {
    const scrubbed = scrubMaybe(crumb.message);
    if (scrubbed !== undefined) crumb.message = scrubbed;
  }

  // The URL is a hash route (`/#/tasks`) and carries no query string of our making, but a
  // pasted recovery link would — so it gets the same treatment as everything else.
  const requestUrl = scrubMaybe(event.request?.url);
  if (requestUrl !== undefined && event.request) event.request.url = requestUrl;

  return event;
}

/**
 * Drops or trims a breadcrumb before it is recorded.
 *
 * Exported for tests; `initSentry` wires it as `beforeBreadcrumb`.
 */
export function sanitizeBreadcrumb(crumb: Sentry.Breadcrumb): Sentry.Breadcrumb | null {
  // Console breadcrumbs are dropped entirely and non-negotiably: a single stray
  // `console.log(action)` anywhere in this codebase would otherwise put a whole op — ingredient
  // names and quantities included — into every subsequent error report.
  if (crumb.category === 'console') return null;
  // Every keystroke's target, and sometimes its value.
  if (crumb.category === 'ui.input') return null;

  if (crumb.category === 'fetch' || crumb.category === 'xhr') {
    const data = crumb.data ?? {};
    // PostgREST puts filter *values* in the query string (`?name=eq.פטרוזיליה`), and
    // AuthContext's membership fetch issues exactly such a request. Keep the shape of the call,
    // throw away everything that identifies what was asked for.
    let url: string | undefined;
    if (typeof data.url === 'string') {
      try {
        const parsed = new URL(data.url, RELATIVE_BASE);
        // A relative URL keeps its path and gains nothing: reporting it under the placeholder
        // origin would be an outright false statement about where the request went.
        url = parsed.origin === RELATIVE_BASE ? parsed.pathname : `${parsed.origin}${parsed.pathname}`;
      } catch {
        url = '[url]';
      }
    }
    return {
      category: crumb.category,
      type: crumb.type,
      level: crumb.level,
      timestamp: crumb.timestamp,
      data: { method: data.method, status_code: data.status_code, url },
    };
  }

  const message = scrubMaybe(crumb.message);
  return message === undefined ? crumb : { ...crumb, message };
}

// --- init ---------------------------------------------------------------------------------

/**
 * Starts Sentry if a DSN is configured. Returns whether it did, so callers (errorUx.ts) can
 * pick exactly one reporting path and never double-report.
 *
 * Note what is *not* configured here: `integrations` is left at its defaults, which includes
 * `globalHandlers` (window.onerror + unhandledrejection). That is deliberate — it means we must
 * not install reporting handlers of our own. See errorUx.ts.
 */
export function initSentry(): boolean {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return false;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: CLIENT_VERSION,
    // SDK v11 replaced the single `sendDefaultPii: false` switch with this per-category object,
    // and its defaults are all `true`. Every one of them is turned off here, because in this
    // app each corresponds to a real leak:
    //
    //   stackFrameVariables  the worst of them by a distance — local variable *values* in every
    //                        captured frame. In this codebase a local is an ingredient, a
    //                        recipe, or the whole AppState. `false`, unconditionally.
    //   httpHeaders          carries `Authorization: Bearer <jwt>` and the anon key on every
    //                        Supabase call.
    //   httpBodies           an `append_ops` POST body *is* the op log.
    //   urlQueryParams       PostgREST puts filter values in the query string (`?name=eq.…`).
    //   userInfo             where an email would be populated from the session automatically;
    //                        `sanitizeEvent` deletes `event.user` as well, so this is belt and
    //                        braces rather than either alone.
    //   cookies, databaseQueryData, queues — not reachable from a browser build today, set for
    //                        the same reason: a future integration shouldn't quietly open one.
    //
    // `frameContextLines` is deliberately left at its default: that is *our own source*, which
    // is what makes a stack trace readable, and contains no user data.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
    tracesSampleRate: 0,
    maxBreadcrumbs: 30,
    beforeBreadcrumb: sanitizeBreadcrumb,
    beforeSend: sanitizeEvent,
  });
  Sentry.setTag('clientVersion', CLIENT_VERSION);
  return true;
}

/** Whether a client is actually running. Cheaper and more honest than caching initSentry's
 * return value in a module global, since Sentry owns that fact. */
export function sentryEnabled(): boolean {
  return Boolean(Sentry.getClient());
}

/** Sets a tag, no-op when Sentry is dormant. Values are scrubbed like everything else — a tag
 * is as visible in the Sentry UI as a message is. */
export function setTag(key: string, value: string | number | undefined): void {
  if (!sentryEnabled()) return;
  Sentry.setTag(key, typeof value === 'string' ? scrubText(value) : value);
}

/**
 * The one breadcrumb this app adds on purpose: the *type* of each dispatched action.
 *
 * `Action['type']` is a closed enum of literals carrying zero user data, and the sequence of
 * them is by far the most useful trail this app can produce ("SET_PRODUCT_QTY, SET_PRODUCT_QTY,
 * CONFIRM_AUTO_TASK_COMPLETION, crash"). The payload is never passed and never should be —
 * sentry.test.ts asserts the crumb has no keys beyond category/message/level.
 */
export function addOpBreadcrumb(actionType: string): void {
  if (!sentryEnabled()) return;
  Sentry.addBreadcrumb(opBreadcrumb(actionType));
}

/** The exact crumb `addOpBreadcrumb` records. Separated so the test can assert its shape
 * without needing a live Sentry client. */
export function opBreadcrumb(actionType: string): Sentry.Breadcrumb {
  return { category: 'op', message: actionType, level: 'info' };
}

/** Reports an error caught by a boundary, returning Sentry's event id (for the "copy this id"
 * affordance on the crash screen) or undefined when dormant. */
export function captureBoundaryError(error: unknown, boundary: string, componentStack?: string): string | undefined {
  if (!sentryEnabled()) {
    // Without a DSN there is nowhere to send this, and a boundary that swallowed the error
    // silently would be worse than no boundary at all during development.
    console.error(`[boundary:${boundary}]`, error);
    return undefined;
  }
  return Sentry.captureException(error, {
    tags: { boundary },
    contexts: componentStack ? { react: { componentStack } } : undefined,
  });
}
