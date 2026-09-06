/**
 * Entity ids used to be `Date.now()`-based, generated in the UI before dispatch. Two devices
 * creating an item in the same millisecond would collide, and the ids carry no randomness at
 * all across clients. `newId` gives every entity a globally-unique id so two kitchens' phones
 * can create ingredients, recipes, tasks, etc. concurrently without ever colliding.
 */
export function newId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  // Old WebViews without crypto.randomUUID: still unique enough for this app's scale.
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${random}`;
}

/**
 * A bare RFC 4122 v4 UUID — unlike `newId`, this carries no prefix, because the one caller that
 * needs it (an op's `opId`) has to satisfy Postgres's `uuid` column type on `ops.op_id`. Falls
 * back to a manual v4 construction on runtimes without `crypto.randomUUID` (still a real UUID,
 * just not cryptographically random — fine for a dedupe key, never used for anything sensitive).
 */
export function newUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const DEVICE_ID_KEY = 'kitchen-device-id';

/** A stable per-browser-profile id, used only for the `client_id` column on `ops` (debugging
 * which device wrote what) — never for identity or auth. Created once, cached in localStorage. */
export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const created = newId('device');
    localStorage.setItem(DEVICE_ID_KEY, created);
    return created;
  } catch {
    return newId('device'); // storage unavailable — a fresh id per call is still harmless
  }
}
