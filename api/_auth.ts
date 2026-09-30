/**
 * Authorization for `/api/scan-recipe`: who is calling, may they, and is there budget left.
 *
 * Shared by the Vercel function and `vite.config.ts`'s dev middleware, the same way `_gemini.ts`
 * is, so dev and production cannot drift on the one thing that guards a paid API.
 *
 * Uses plain `fetch` against PostgREST rather than `@supabase/supabase-js` — one HTTP call does
 * not justify a client library in the serverless bundle.
 *
 * ## Why the RPC *is* the check
 *
 * The caller's own token is forwarded to PostgREST, which verifies it upstream. The three
 * alternatives, and why each is worse:
 *
 *   `auth.getUser(token)` — one round trip that answers only "who", not "may they" and not "is
 *   there budget". The atomic counter still needs the RPC, so this costs two round trips for
 *   what one gives.
 *
 *   Local JWT signature verification — puts a real secret (SUPABASE_JWT_SECRET) in two more
 *   places, breaks the day Supabase rotates to asymmetric signing keys, and proves only "this
 *   token was minted at some point": a deleted user's unexpired JWT passes, a non-member passes.
 *   The least useful answer at the highest operational cost.
 *
 *   The RPC — verifies the signature (free, upstream, always current), the authorization
 *   (membership) and the quota (atomically, under a row lock) in a single round trip.
 *
 * ## Fail closed, deliberately
 *
 * If Supabase is unreachable or misconfigured, this returns 503 and the caller never reaches
 * Gemini. Here the cost of a wrong answer is money, so refusing is right. Contrast
 * `src/lib/appConfig.ts`, which fails *open*: there the cost of a wrong answer is a stopped
 * kitchen, which is worse than the incident the switch exists to contain.
 */

export type QuotaFailure = 'unauthorized' | 'forbidden' | 'quota' | 'maintenance' | 'unavailable';

export type QuotaResult =
  | { ok: true; remaining: number }
  | { ok: false; status: number; error: QuotaFailure };

export type SupabaseEnv = {
  url?: string;
  anonKey?: string;
  /** Escape hatch for a deployment that genuinely has no accounts (see `scanAuthMode`). */
  allowAnonymous?: boolean;
};

/** Pulls the bearer token out of an Authorization header. Returns null for anything else — a
 * malformed header is treated as no token at all, never as a token to try. */
export function bearerToken(header: string | undefined | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

/**
 * Whether a browser at `origin` may call this endpoint.
 *
 * **Say plainly what this buys:** it stops *another website* from spending our Gemini budget
 * through a signed-in user's browser. It stops nothing scripted — `curl -H 'Origin: …'` walks
 * straight through, and so does a request with no Origin at all (allowed here on purpose, so
 * non-browser callers and the verification script still work). The quota is what actually
 * bounds cost; this is a cheap extra layer, not a control.
 *
 * `host` makes it self-configuring: production, every preview deployment and localhost all
 * satisfy "the Origin's host is the host this request was sent to", with no env var to keep in
 * step with a URL that changes per branch.
 */
export function isAllowedOrigin(
  origin: string | undefined | null,
  host: string | undefined | null,
  allowlist: readonly string[] = [],
): boolean {
  if (!origin) return true; // not a browser — bounded by the token and quota instead
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false; // a syntactically impossible Origin is not something to wave through
  }
  if (host && originHost === host) return true;
  return allowlist.some((entry) => {
    const trimmed = entry.trim();
    if (!trimmed) return false;
    try {
      return new URL(trimmed).host === originHost;
    } catch {
      return trimmed === originHost;
    }
  });
}

/** Splits the comma-separated SCAN_ALLOWED_ORIGINS env var. */
export function parseAllowlist(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * How this deployment authenticates scans.
 *
 * `'supabase'` — the normal case: a token is required and the RPC decides.
 * `'open'`     — this deployment has no Supabase at all AND has explicitly opted out, so there
 *                is no notion of a user to check. Behaves exactly as the endpoint did before
 *                this phase.
 * `'closed'`   — Supabase is not configured and nobody opted out: refuse.
 *
 * `'closed'` is the default for a reason. Silently falling back to `'open'` when the env vars
 * are missing would turn "forgot to set SUPABASE_URL in Vercel" into "the Gemini budget is
 * public", which is precisely the failure this whole phase exists to prevent.
 */
export function scanAuthMode(env: SupabaseEnv): 'supabase' | 'open' | 'closed' {
  if (env.url && env.anonKey) return 'supabase';
  return env.allowAnonymous ? 'open' : 'closed';
}

/** Reads the Supabase settings a server runtime needs. `VITE_`-prefixed names are accepted as a
 * fallback because Vercel exposes every project env var to functions, so the ones already set
 * for the browser build work here too — no duplicate configuration to keep in step. */
export function readSupabaseEnv(env: Record<string, string | undefined>): SupabaseEnv {
  return {
    url: env.SUPABASE_URL || env.VITE_SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY,
    allowAnonymous: env.SCAN_ALLOW_ANONYMOUS === '1',
  };
}

const RPC_TIMEOUT_MS = 5_000;

/**
 * Calls `consume_scan_quota()` as the caller. One round trip that authenticates, authorizes and
 * consumes a unit of quota, or explains which of the three it refused on.
 */
export async function consumeScanQuota(token: string | null, env: SupabaseEnv): Promise<QuotaResult> {
  const mode = scanAuthMode(env);
  if (mode === 'open') return { ok: true, remaining: Number.POSITIVE_INFINITY };
  if (mode === 'closed') {
    console.error('[scan-recipe] refusing: Supabase is not configured, so quota cannot be enforced');
    return { ok: false, status: 503, error: 'unavailable' };
  }
  if (!token) return { ok: false, status: 401, error: 'unauthorized' };

  let response: Response;
  try {
    response = await fetch(`${env.url}/rest/v1/rpc/consume_scan_quota`, {
      method: 'POST',
      headers: {
        apikey: env.anonKey!,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
  } catch (err) {
    console.error('[scan-recipe] quota check could not reach Supabase:', (err as Error)?.name);
    return { ok: false, status: 503, error: 'unavailable' };
  }

  // 401 from PostgREST means the token didn't verify; 403 covers a token that verified but is
  // not allowed to execute the function at all.
  if (response.status === 401) return { ok: false, status: 401, error: 'unauthorized' };
  if (response.status === 403) return { ok: false, status: 403, error: 'forbidden' };

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    console.error('[scan-recipe] quota check returned an unreadable body, HTTP', response.status);
    return { ok: false, status: 503, error: 'unavailable' };
  }

  if (!response.ok) {
    // The RPC raises 42501 for "no session" and "not a member"; PostgREST surfaces that as a
    // 4xx with the message in `message`. Both are refusals, not outages.
    const message = (payload as { message?: unknown })?.message;
    const text = typeof message === 'string' ? message : '';
    if (text.includes('not_authenticated')) return { ok: false, status: 401, error: 'unauthorized' };
    if (text.includes('not_a_member')) return { ok: false, status: 403, error: 'forbidden' };
    console.error('[scan-recipe] quota check failed, HTTP', response.status);
    return { ok: false, status: 503, error: 'unavailable' };
  }

  const status = (payload as { status?: unknown })?.status;
  if (status === 'maintenance') return { ok: false, status: 503, error: 'maintenance' };
  if (status === 'quota') return { ok: false, status: 429, error: 'quota' };
  if (status !== 'ok') {
    console.error('[scan-recipe] quota check returned an unrecognized status');
    return { ok: false, status: 503, error: 'unavailable' };
  }

  const remaining = (payload as { remaining?: unknown })?.remaining;
  return { ok: true, remaining: typeof remaining === 'number' ? remaining : 0 };
}
