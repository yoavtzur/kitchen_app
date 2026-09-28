import { downscaleImage } from './imageDownscale';
import type { Unit } from '../types';

/**
 * Turns a photo of a written recipe into structured data via Google Gemini.
 *
 * The API key never reaches the browser: this module posts the photo to our own
 * `/api/scan-recipe` endpoint, which holds `GEMINI_API_KEY` server-side and talks to Google
 * on our behalf (see `api/_gemini.ts`). The browser only ever sees the model's reply text.
 *
 * Deliberately name-based, not id-based: the model can only read what is printed on the page,
 * so it returns ingredient *names*. Resolving those names against this kitchen's actual
 * `Ingredient`/`Product` rows is a separate, pure step — see `scannedToDraft` in
 * `src/lib/recipeDraft.ts`. Nothing here touches the store or dispatches anything; the result
 * is a draft the cook reviews and saves by hand in `RecipeEditor`.
 */

/** One ingredient line as the model read it off the page. */
export type ScannedIngredient = {
  /** Ingredient name in the source language (Hebrew, normally). */
  name: string;
  /** Quantity as written, or null when the page gives none ("מלח לפי הטעם"). */
  qty: number | null;
  /**
   * The written unit mapped onto one of the app's five units, or null when it maps onto none
   * of them. Read together with `unitText`: null with no `unitText` means no unit was written
   * ("2 ביצים"), while null WITH `unitText` means a unit was written that the app cannot
   * represent ("חצי כפית") — and then `qty` is in a unit we don't have, so it must not be used.
   */
  unit: Unit | null;
  /** The unit exactly as written on the page, or null when none was written. */
  unitText: string | null;
  /** The whole line verbatim, so the cook can see exactly what the AI read. */
  raw: string;
};

/**
 * A recipe as read off a photo.
 *
 * `servings`, `prepTimeMinutes` and `cookTimeMinutes` have NO home in this app's `Recipe`
 * type (`src/types.ts`) — it stores `yieldQty`/`yieldUnit`/`items`/`steps` and nothing about
 * time. They are captured anyway so the scan result can show the cook everything that was on
 * the page; only `servings` feeds the draft, and only as a fallback yield (see `scannedToDraft`).
 * Persisting the two time fields would mean a new `Recipe` field, a `SCHEMA_VERSION` bump and a
 * migration — see CLAUDE.md — which this feature deliberately does not do.
 */
export type ScannedRecipe = {
  name: string;
  yieldQty: number | null;
  yieldUnit: Unit | null;
  servings: number | null;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  ingredients: ScannedIngredient[];
  steps: string[];
};

export type GeminiScanErrorCode =
  | 'no-api-key'
  | 'too-large'
  | 'network'
  | 'http'
  | 'bad-response'
  | 'unreadable'
  /** The photo isn't a type the server will forward (see ALLOWED_MIME in api/_gemini.ts). */
  | 'bad-mime'
  /** Gemini took too long. Distinct from `network` because retrying later is the right advice. */
  | 'timeout'
  /** Not signed in, or the session expired. */
  | 'unauthorized'
  /** Signed in but not a member of any restaurant — no quota to draw on. */
  | 'forbidden'
  /** This restaurant's (or the whole app's) daily scan allowance is used up. Deliberately
   * distinct from a Gemini-side 429, which is a transient upstream throttle — a different thing
   * entirely to a cook, and it needs different words. */
  | 'quota'
  /** Scanning is switched off from app_config. */
  | 'maintenance'
  /** The server couldn't check the quota, so it refused rather than spend the budget blind. */
  | 'unavailable';

/** Carries a machine-readable `code` so the UI can pick its own Hebrew wording per failure. */
export class GeminiScanError extends Error {
  readonly code: GeminiScanErrorCode;
  readonly status?: number;

  constructor(code: GeminiScanErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'GeminiScanError';
    this.code = code;
    this.status = status;
  }
}

const SCAN_ENDPOINT = '/api/scan-recipe';

/** Client-side ceiling on one scan. Above the server's 20s Gemini timeout and its 30s
 * maxDuration, so the server's own error reaches us first whenever it can. */
const SCAN_TIMEOUT_MS = 35_000;

/**
 * Asks the server whether a Gemini key is configured, so the UI only offers the AI button
 * when pressing it would actually work. The browser cannot check this itself — that is the
 * whole point of the key being server-side.
 *
 * Returns false for any failure, including a 404 from a static host with no functions, which
 * makes "no AI available, fall back to on-device OCR" the safe default everywhere.
 */
export async function isGeminiConfigured(): Promise<boolean> {
  try {
    const response = await fetch(SCAN_ENDPOINT, { method: 'GET' });
    if (!response.ok) return false;
    const body = (await response.json()) as { configured?: unknown };
    return body?.configured === true;
  } catch {
    return false;
  }
}

const UNIT_ALIASES: Record<string, Unit> = {
  // weight
  'ק"ג': 'kg', 'קג': 'kg', 'קילו': 'kg', 'קילוגרם': 'kg', kg: 'kg', kgs: 'kg', kilo: 'kg', kilogram: 'kg', kilograms: 'kg',
  גרם: 'g', 'גר': 'g', 'ג': 'g', g: 'g', gr: 'g', gram: 'g', grams: 'g',
  // volume
  ליטר: 'l', l: 'l', lt: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  'מ"ל': 'ml', 'מל': 'ml', מיליליטר: 'ml', ml: 'ml', milliliter: 'ml', milliliters: 'ml',
  // countable
  "יח'": 'unit', 'יח': 'unit', יחידה: 'unit', יחידות: 'unit', unit: 'unit', units: 'unit',
  piece: 'unit', pieces: 'unit', pcs: 'unit',
};

/**
 * Maps a written unit onto one of the app's five units, or null when it maps onto none of them.
 * Cups, spoons and pinches deliberately return null rather than a fabricated conversion — the
 * app has no density model, so "2 כוסות קמח" cannot honestly become grams.
 */
export function normalizeUnit(raw: unknown): Unit | null {
  if (typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase().replace(/\.$/, '');
  if (!key) return null;
  return UNIT_ALIASES[key] ?? null;
}

/** Coerces to a finite non-negative number, else null. Accepts numeric strings ("1.5"). */
function toNumberOrNull(value: unknown): number | null {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null;
  return n;
}

function toTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Validates whatever the model returned into a `ScannedRecipe`, dropping anything malformed.
 * Exported separately from the network call so it can be tested against captured responses.
 */
export function sanitizeScanned(raw: unknown): ScannedRecipe {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const ingredientsRaw = Array.isArray(obj.ingredients) ? obj.ingredients : [];
  const ingredients: ScannedIngredient[] = [];
  for (const entry of ingredientsRaw) {
    if (!entry || typeof entry !== 'object') continue;
    const line = entry as Record<string, unknown>;
    const name = toTrimmedString(line.name);
    if (!name) continue;
    const unitText = toTrimmedString(line.unit);
    ingredients.push({
      name,
      qty: toNumberOrNull(line.qty),
      unit: normalizeUnit(line.unit),
      unitText: unitText || null,
      raw: toTrimmedString(line.raw) || name,
    });
  }

  const steps = (Array.isArray(obj.steps) ? obj.steps : [])
    .map(toTrimmedString)
    .filter((s): s is string => s.length > 0);

  return {
    name: toTrimmedString(obj.name),
    yieldQty: toNumberOrNull(obj.yieldQty),
    yieldUnit: normalizeUnit(obj.yieldUnit),
    servings: toNumberOrNull(obj.servings),
    prepTimeMinutes: toNumberOrNull(obj.prepTimeMinutes),
    cookTimeMinutes: toNumberOrNull(obj.cookTimeMinutes),
    ingredients,
    steps,
  };
}

/** True when the model came back with nothing worth putting in front of the cook. */
function isEmptyScan(scanned: ScannedRecipe): boolean {
  return !scanned.name && scanned.ingredients.length === 0 && scanned.steps.length === 0;
}

/** Maps an error code reported by our own endpoint onto the client's error vocabulary. */
/** Every code the server can send, mapped straight through; the status-based fallbacks only
 * cover a response that didn't come from our own handler at all (a platform 413, a proxy). */
const SERVER_CODES = new Set<GeminiScanErrorCode>([
  'no-api-key',
  'too-large',
  'bad-response',
  'bad-mime',
  'timeout',
  'unauthorized',
  'forbidden',
  'quota',
  'maintenance',
  'unavailable',
]);

function codeFromServer(raw: unknown, httpStatus: number): GeminiScanErrorCode {
  if (typeof raw === 'string' && SERVER_CODES.has(raw as GeminiScanErrorCode)) {
    return raw as GeminiScanErrorCode;
  }
  if (httpStatus === 413) return 'too-large';
  if (httpStatus === 401) return 'unauthorized';
  if (httpStatus === 403) return 'forbidden';
  if (httpStatus === 429) return 'quota';
  return 'http';
}

/**
 * Sends `file` to our `/api/scan-recipe` endpoint and returns the recipe Gemini read off it.
 *
 * The photo is downscaled first (see `downscaleImage`) so a full-size phone picture doesn't
 * blow the serverless request-body limit.
 *
 * Throws {@link GeminiScanError} — never a bare Error — so the UI can branch on `.code`:
 * `no-api-key`, `too-large`, `network`, `http`, `bad-response`, `unreadable`.
 *
 * @example
 * try {
 *   const scanned = await parseRecipeFromImage(file);
 *   const draft = scannedToDraft(scanned, state);   // see lib/recipeDraft.ts
 * } catch (err) {
 *   if (err instanceof GeminiScanError && err.code === 'no-api-key') { ... }
 * }
 */
export async function parseRecipeFromImage(file: File, accessToken?: string | null): Promise<ScannedRecipe> {
  let image;
  try {
    image = await downscaleImage(file);
  } catch {
    throw new GeminiScanError('unreadable', 'לא ניתן לקרוא את קובץ התמונה');
  }

  let response: Response;
  try {
    response = await fetch(SCAN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // The server forwards this to Supabase, which verifies it and decides whether this
        // account may scan and has budget left — see api/_auth.ts. Omitted when there is no
        // session; the server then answers 401, which is the honest outcome.
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ imageBase64: image.base64, mimeType: image.mimeType }),
      // A scan that never comes back is worse than one that fails: without this the sheet sits
      // on "סורק..." forever. Comfortably above the server's own 20s Gemini timeout, so a real
      // upstream timeout still arrives as a proper error rather than being cut off here.
      signal: AbortSignal.timeout(SCAN_TIMEOUT_MS),
    });
  } catch (err) {
    const name = (err as Error)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new GeminiScanError('timeout', 'הסריקה ארכה זמן רב מדי');
    }
    throw new GeminiScanError('network', 'אין חיבור לשרת');
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new GeminiScanError('bad-response', 'תשובה לא תקינה מהשרת');
  }

  if (!response.ok) {
    const serverError = (payload as { error?: unknown; status?: unknown })?.error;
    const upstream = (payload as { status?: unknown })?.status;
    const code = codeFromServer(serverError, response.status);
    throw new GeminiScanError(
      code,
      'סריקת המתכון נכשלה',
      typeof upstream === 'number' ? upstream : response.status,
    );
  }

  const text = (payload as { text?: unknown })?.text;
  if (typeof text !== 'string' || !text) {
    throw new GeminiScanError('bad-response', 'תשובה ריקה מהשרת');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new GeminiScanError('bad-response', 'תשובה לא תקינה מהשרת');
  }

  const scanned = sanitizeScanned(parsed);
  if (isEmptyScan(scanned)) {
    throw new GeminiScanError('unreadable', 'לא זוהה מתכון בתמונה');
  }
  return scanned;
}
