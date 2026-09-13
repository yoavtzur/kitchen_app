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
 */

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
export type ScanErrorCode = 'no-api-key' | 'too-large' | 'bad-request' | 'http' | 'bad-response';

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
    const cause = (err as { cause?: { code?: string } })?.cause;
    console.error('[scan-recipe] could not reach Gemini:', cause?.code ?? (err as Error)?.name);
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
