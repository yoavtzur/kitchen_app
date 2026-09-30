/**
 * Server-side Gemini call, shared by the Vercel function (`api/scan-recipe.ts`) and the Vite
 * dev middleware (`vite.config.ts`) so both behave identically.
 *
 * The whole point of this file living on the server is the API key: `GEMINI_API_KEY` has no
 * `VITE_` prefix, so Vite never inlines it into the browser bundle. The browser sends a photo
 * to our own endpoint and gets text back; it never sees the key.
 *
 * Deliberately thin — it does not interpret the recipe. Parsing and sanitizing the model's
 * JSON stays in `src/lib/geminiScanner.ts`, where it is pure and unit-tested.
 *
 * `handleScanRequest` below is the whole request pipeline, authorization included, so both
 * callers are thin adapters over one implementation rather than two similar ones.
 */
import {
  bearerToken,
  consumeScanQuota,
  isAllowedOrigin,
  type QuotaFailure,
  type SupabaseEnv,
} from './_auth.js';

/**
 * Google retires models for new API keys while still listing them in `GET /models`, so a
 * model appearing in that list is no proof it can be called. Both gemini-1.5-flash and
 * gemini-2.5-flash already went this way (404 NOT_FOUND "no longer available to new users").
 * gemini-3.6-flash is what Google's own error message pointed to. If this 404s too, the
 * `gemini-flash-latest` alias tracks the current flash model and avoids pinning altogether.
 */
const GEMINI_MODEL = 'gemini-3.6-flash';

/**
 * Vercel's Hobby plan caps a function request body at ~4.5MB, and base64 inflates bytes by
 * about a third. The client downscales before uploading, so this is a backstop, not the
 * normal path.
 */
const MAX_BASE64_CHARS = 3_000_000;

/** Upper bound on the raw request body, checked from Content-Length before anything is read.
 * Slightly above MAX_BASE64_CHARS to leave room for the JSON envelope. */
export const MAX_BODY_BYTES = 4_000_000;

/** How long to wait on Gemini. Must stay below the function's own `maxDuration` so this fires
 * first and the caller gets a real error code rather than a platform-level 504. */
const GEMINI_TIMEOUT_MS = 20_000;

/**
 * Image types Gemini accepts that this app can actually produce.
 *
 * HEIC/HEIF are in the list and must stay in it: `imageDownscale.ts` falls back to the file's
 * own `file.type` when canvas decoding fails, which on older iOS is `image/heic`. Dropping them
 * would reject exactly the phones most likely to need the fallback.
 */
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

/** Standard base64, optionally padded. Without this a four-character body bought a full Gemini
 * call; with it, and the length floor below, a junk payload is free to reject. */
const BASE64_SHAPE = /^[A-Za-z0-9+/]*={0,2}$/;

/** Below this it is not a photograph of anything — the smallest downscaled JPEG this app
 * produces is far larger. */
const MIN_BASE64_CHARS = 1024;

const PROMPT = `You are reading a photograph of a cooking recipe, most likely written in Hebrew.
Extract the recipe and reply with JSON only, matching exactly this shape:

{
  "name": string,
  "yieldQty": number | null,
  "yieldUnit": string | null,
  "servings": number | null,
  "prepTimeMinutes": number | null,
  "cookTimeMinutes": number | null,
  "ingredients": [{ "name": string, "qty": number | null, "unit": string | null, "raw": string }],
  "steps": [string]
}

Rules:
- Keep the original language of the recipe. Do not translate.
- "raw" is the ingredient line exactly as printed, including its quantity and unit.
- "name" on an ingredient is just the ingredient itself, with no quantity and no unit.
- Use null, never a guess, for anything the photo does not state. Never invent ingredients or steps.
- "qty" must be a plain number: convert fractions ("חצי", "1/2") to decimals (0.5).
- "unit" is the unit as written (for example "גרם", "כפית", "כוס"); leave null if none is written.
- "steps" is the method, one entry per step, in order, without leading numbers.
- If the photo is not a recipe at all, return the shape above with an empty name, empty
  ingredients and empty steps.`;

/** Mirrors GeminiScanErrorCode in src/lib/geminiScanner.ts. */
export type ScanErrorCode =
  | 'no-api-key'
  | 'too-large'
  | 'bad-request'
  | 'bad-mime'
  | 'http'
  | 'timeout'
  | 'bad-response'
  | 'unauthorized'
  | 'forbidden'
  | 'quota'
  | 'maintenance'
  | 'unavailable';

export type ScanReply = {
  status: number;
  body: { text: string } | { error: ScanErrorCode; status?: number };
};

/**
 * The key is passed in rather than read from `process.env` here, so the Vite dev middleware
 * can hand over what `loadEnv` found without mutating the dev server's global environment
 * (which would then go stale the moment .env.local changed).
 */
export function hasApiKey(apiKey: string | undefined): boolean {
  return (apiKey ?? '').trim().length > 0;
}

// ── the whole request pipeline, in one place ─────────────────────────────────

/** What a scan request looks like, stripped of whichever HTTP framework delivered it. */
export type ScanRequest = {
  method: string | undefined;
  origin: string | undefined;
  /** The Host header, so the origin check can be "the page that called us", self-configuring
   * across production, every preview URL and localhost. */
  host: string | undefined;
  authorization: string | undefined;
  contentLength: string | undefined;
  /** Already-parsed JSON, or the raw string when the runtime didn't parse it. */
  body: unknown;
};

export type ScanEnv = {
  geminiApiKey: string | undefined;
  supabase: SupabaseEnv;
  allowedOrigins: readonly string[];
};

export type ScanHttpReply = {
  status: number;
  headers: Record<string, string>;
  body: unknown;
};

function fail(status: number, error: ScanErrorCode, headers: Record<string, string> = {}): ScanHttpReply {
  return { status, headers: { 'Cache-Control': 'no-store', ...headers }, body: { error } };
}

const QUOTA_ERROR_STATUS: Record<QuotaFailure, ScanErrorCode> = {
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  quota: 'quota',
  maintenance: 'maintenance',
  unavailable: 'unavailable',
};

/**
 * The complete `/api/scan-recipe` request pipeline.
 *
 * Both callers — the Vercel function and `vite.config.ts`'s dev middleware — are now ~10-line
 * adapters over this, which is the arrangement those two files always claimed to have and only
 * half did. Anything that guards a paid endpoint must not exist in two versions.
 *
 * The order below is the security-relevant part, and it is deliberate: everything that can
 * refuse the request for free happens before anything that costs money or a round trip.
 *
 *   origin → method → Content-Length → JSON parse → mime/base64/size   (no network yet)
 *   → bearer token → consumeScanQuota                                   (one round trip)
 *   → scanRecipeImage                                                   (the paid call)
 *
 * Quota is consumed *after* the cheap validation specifically because there is no refund path:
 * a malformed request must not be able to burn a unit, so only a genuine upstream failure costs
 * anything.
 */
export async function handleScanRequest(req: ScanRequest, env: ScanEnv): Promise<ScanHttpReply> {
  if (!isAllowedOrigin(req.origin, req.host, env.allowedOrigins)) {
    return fail(403, 'forbidden');
  }

  if (req.method === 'GET') {
    // Never cached: whether a key is present can change without the bundle changing.
    return { status: 200, headers: { 'Cache-Control': 'no-store' }, body: { configured: hasApiKey(env.geminiApiKey) } };
  }
  if (req.method !== 'POST') {
    return fail(405, 'bad-request');
  }

  const declaredLength = Number(req.contentLength);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return fail(413, 'too-large');
  }

  let parsed: unknown = req.body;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return fail(400, 'bad-request');
    }
  }

  const check = validateScanBody(parsed);
  if (check.error) return fail(check.status, check.error);

  const quota = await consumeScanQuota(bearerToken(req.authorization), env.supabase);
  if (!quota.ok) return fail(quota.status, QUOTA_ERROR_STATUS[quota.error]);

  const reply = await scanRecipeImage(parsed, env.geminiApiKey);
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  if (Number.isFinite(quota.remaining)) headers['X-Scan-Quota-Remaining'] = String(quota.remaining);
  return { status: reply.status, headers, body: reply.body };
}

/**
 * Everything about the payload that can be judged without a network call. Exported so
 * `_gemini.test.ts` can pin each rule without standing up an HTTP server.
 */
export function validateScanBody(
  parsed: unknown,
): { error: null } | { error: ScanErrorCode; status: number } {
  const body = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
  const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : '';
  // Matches scanRecipeImage's own default, so the two can't disagree about an absent mimeType.
  const mimeType = typeof body.mimeType === 'string' && body.mimeType ? body.mimeType : 'image/jpeg';

  if (!ALLOWED_MIME.has(mimeType.toLowerCase())) return { error: 'bad-mime', status: 400 };
  if (!imageBase64) return { error: 'bad-request', status: 400 };
  if (imageBase64.length > MAX_BASE64_CHARS) return { error: 'too-large', status: 413 };
  if (imageBase64.length < MIN_BASE64_CHARS) return { error: 'bad-request', status: 400 };
  if (!BASE64_SHAPE.test(imageBase64)) return { error: 'bad-request', status: 400 };
  return { error: null };
}

/** Digs the model's text out of the Gemini response envelope. */
function extractText(payload: unknown): string {
  const candidates = (payload as { candidates?: unknown })?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return '';
  const parts = (candidates[0] as { content?: { parts?: unknown } })?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((p) => (p as { text?: unknown })?.text)
    .filter((t): t is string => typeof t === 'string')
    .join('')
    .trim();
}

/**
 * Sends one image to Gemini and returns the raw JSON text it replied with.
 *
 * Never throws and never echoes the API key or the upstream error body back to the browser —
 * a Gemini error becomes a bare status code, so a misconfigured key can't leak through an
 * error message.
 */
export async function scanRecipeImage(rawBody: unknown, rawApiKey: string | undefined): Promise<ScanReply> {
  const apiKey = (rawApiKey ?? '').trim();
  if (!apiKey) return { status: 503, body: { error: 'no-api-key' } };

  const body = (rawBody && typeof rawBody === 'object' ? rawBody : {}) as Record<string, unknown>;
  const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : '';
  const mimeType = typeof body.mimeType === 'string' && body.mimeType ? body.mimeType : 'image/jpeg';

  if (!imageBase64) return { status: 400, body: { error: 'bad-request' } };
  if (imageBase64.length > MAX_BASE64_CHARS) return { status: 413, body: { error: 'too-large' } };

  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // There was no timeout here at all: a hung Gemini call held the function open until the
        // platform killed it, and the cook got nothing useful. Paired with the function's own
        // `maxDuration`, so this fires first.
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
        body: JSON.stringify({
          contents: [
            { parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType, data: imageBase64 } }] },
          ],
          generationConfig: { responseMimeType: 'application/json', temperature: 0 },
        }),
      },
    );
  } catch (err) {
    // Logs only the error code (e.g. a TLS failure), never the URL — the key is in its query.
    const name = (err as Error)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      console.error('[scan-recipe] Gemini timed out after', GEMINI_TIMEOUT_MS, 'ms');
      return { status: 504, body: { error: 'timeout' } };
    }
    const cause = (err as { cause?: { code?: string } })?.cause;
    console.error('[scan-recipe] could not reach Gemini:', cause?.code ?? name);
    return { status: 502, body: { error: 'http' } };
  }

  if (!response.ok) {
    console.error('[scan-recipe] Gemini returned HTTP', response.status);
    return { status: 502, body: { error: 'http', status: response.status } };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { status: 502, body: { error: 'bad-response' } };
  }

  const text = extractText(payload);
  if (!text) return { status: 502, body: { error: 'bad-response' } };

  return { status: 200, body: { text } };
}
