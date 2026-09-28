// The client half of the kill switch: reads the single `app_config` row and tells the app
// whether to stop entirely, stop writing, or carry on.
//
// ## Fails OPEN, and that is the whole design
//
// Every read that doesn't succeed — no network, RLS says no, the migration hasn't been applied
// yet, the JSON is a shape we don't recognize — yields `null`, and every caller treats `null` as
// "no restriction". A kill switch that failed *closed* would convert every wifi blip in a
// kitchen into a kitchen-wide outage: strictly worse than the incident it exists to contain.
//
// That is the opposite of `api/_auth.ts`, which fails closed. The asymmetry is intentional: on
// the server a wrong answer costs money, here a wrong answer costs a stopped kitchen.
import { supabase } from './supabase';

export type AppConfig = {
  maintenanceMode: boolean;
  maintenanceMessage: string | null;
  readOnlyMode: boolean;
  minClientVersion: string | null;
};

/** Cached so a real maintenance window survives a cold start with no network... */
const CACHE_KEY = 'kitchen-app-config';
/** ...but not so long that it outlives the incident. Six hours is well past any window we'd
 * actually run, and well short of "a cook is locked out tomorrow because of yesterday". */
const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

const REFRESH_INTERVAL_MS = 15 * 60 * 1000;
/** Don't re-fetch on every tab switch — a cook flips between apps constantly. */
const FOCUS_THROTTLE_MS = 60 * 1000;

type Listener = () => void;

let current: AppConfig | null = readCache();
let lastFetchAt = 0;
let started = false;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener();
}

function parse(raw: unknown): AppConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  return {
    maintenanceMode: row.maintenance_mode === true,
    maintenanceMessage: typeof row.maintenance_message === 'string' ? row.maintenance_message : null,
    readOnlyMode: row.read_only_mode === true,
    minClientVersion: typeof row.min_client_version === 'string' ? row.min_client_version : null,
  };
}

function readCache(): AppConfig | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { at, value } = JSON.parse(raw) as { at: number; value: AppConfig };
    if (typeof at !== 'number' || Date.now() - at > CACHE_MAX_AGE_MS) return null;
    return value;
  } catch {
    return null;
  }
}

function writeCache(value: AppConfig | null): void {
  try {
    if (value) localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), value }));
    else localStorage.removeItem(CACHE_KEY);
  } catch {
    // storage unavailable (private mode, quota) — matching storage.ts's convention
  }
}

/**
 * Fetches the row. Resolves to `null` on any failure whatsoever, which callers read as
 * "no restriction" — see the note at the top of this file.
 *
 * Note it reads through `supabase` rather than the authenticated session: the SELECT policy
 * grants `anon` as well as `authenticated`, deliberately, so a client whose *auth path itself*
 * is broken can still be switched off.
 */
export async function fetchAppConfig(): Promise<AppConfig | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('app_config')
      .select('maintenance_mode, maintenance_message, read_only_mode, min_client_version')
      .maybeSingle();
    if (error || !data) return null;
    return parse(data);
  } catch {
    return null;
  }
}

async function refresh(): Promise<void> {
  lastFetchAt = Date.now();
  const next = await fetchAppConfig();
  // A failed fetch must not clear a maintenance flag we already know about — that would make a
  // flaky connection look like "the incident is over". The cache's own max age is what
  // eventually expires it.
  if (next === null && current !== null) return;
  current = next;
  writeCache(next);
  emit();
}

/** Current config, or null when we have no trustworthy answer. Synchronous — callers render
 * from the cache immediately and re-render when a fresh read lands. */
export function getAppConfig(): AppConfig | null {
  return current;
}

export function subscribeAppConfig(listener: Listener): () => void {
  listeners.add(listener);
  start();
  return () => listeners.delete(listener);
}

/** Starts the poll loop once, on first subscriber. Module-level rather than in a `useEffect`,
 * for the same reason `getSyncStore` is: it survives StrictMode's double invocation by
 * construction instead of by a guard. */
function start(): void {
  if (started || !supabase) return;
  started = true;
  void refresh();
  if (typeof window === 'undefined') return;
  setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - lastFetchAt < FOCUS_THROTTLE_MS) return;
    void refresh();
  });
}

/**
 * Whether this build is older than the minimum the server will accept.
 *
 * Compares dotted numeric segments, ignoring any non-numeric suffix (`1.4.0-rc1` compares as
 * `1.4.0`). **Returns false whenever either side can't be read that way** — including the
 * default `VITE_APP_VERSION` of `dev` — so a client is never locked out by a version string
 * nobody can interpret. Fail-open, like everything else in this file.
 */
export function isClientOutdated(clientVersion: string | undefined, minVersion: string | null): boolean {
  const client = parseVersion(clientVersion);
  const min = parseVersion(minVersion);
  if (!client || !min) return false;
  const length = Math.max(client.length, min.length);
  for (let i = 0; i < length; i++) {
    const a = client[i] ?? 0;
    const b = min[i] ?? 0;
    if (a !== b) return a < b;
  }
  return false;
}

function parseVersion(raw: string | undefined | null): number[] | null {
  if (!raw) return null;
  const segments = raw.trim().replace(/^v/i, '').split('.');
  const numbers: number[] = [];
  for (const segment of segments) {
    const match = /^(\d+)/.exec(segment);
    if (!match) break;
    numbers.push(Number(match[1]));
  }
  return numbers.length > 0 ? numbers : null;
}

/** Test seam: resets the module singleton so each test starts from nothing. */
export function __resetAppConfigForTests(): void {
  current = null;
  started = false;
  lastFetchAt = 0;
  listeners.clear();
}
