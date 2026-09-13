import type { Unit } from '../types';

/**
 * Turns a photo of a written recipe into structured data via Google Gemini.
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
   * of them (cups, spoons, pinches). Null is not a failure — the caller falls back to the
   * matched ingredient's own stock unit, which is nearly always the right guess.
   */
  unit: Unit | null;
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
  | 'unreadable';

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

/**
 * gemini-1.5-flash (the model this feature was originally specced against) is retired for new
 * API keys, so it 404s rather than answering. 2.5-flash is the current equivalent: same
 * cheap/fast tier, same multimodal input. To go back, change this one string.
 */
const GEMINI_MODEL = 'gemini-2.5-flash';

/** Inline image data has to travel inside the JSON request, so keep a sane ceiling. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const API_KEY: string = import.meta.env.VITE_GEMINI_API_KEY ?? '';

/** False when no key is configured — callers fall back to plain on-device OCR. */
export function isGeminiConfigured(): boolean {
  return API_KEY.trim().length > 0;
}

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

/** Reads a File as base64 with the `data:...;base64,` prefix stripped, as the API expects. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new GeminiScanError('unreadable', 'לא ניתן לקרוא את קובץ התמונה'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new GeminiScanError('unreadable', 'לא ניתן לקרוא את קובץ התמונה'));
        return;
      }
      const comma = result.indexOf(',');
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
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
    ingredients.push({
      name,
      qty: toNumberOrNull(line.qty),
      unit: normalizeUnit(line.unit),
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

/** Digs the model's text out of the Gemini response envelope. */
function extractText(payload: unknown): string {
  const candidates = (payload as { candidates?: unknown })?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return '';
  const parts = (candidates[0] as { content?: { parts?: unknown } })?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((p) => ((p as { text?: unknown })?.text))
    .filter((t): t is string => typeof t === 'string')
    .join('')
    .trim();
}

/**
 * Sends `file` to Gemini and returns the recipe it read off the page.
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
export async function parseRecipeFromImage(file: File): Promise<ScannedRecipe> {
  if (!isGeminiConfigured()) {
    throw new GeminiScanError('no-api-key', 'לא הוגדר מפתח Gemini');
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new GeminiScanError('too-large', 'התמונה גדולה מדי');
  }

  const base64 = await fileToBase64(file);

  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(API_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: PROMPT },
                { inline_data: { mime_type: file.type || 'image/jpeg', data: base64 } },
              ],
            },
          ],
          generationConfig: { responseMimeType: 'application/json', temperature: 0 },
        }),
      },
    );
  } catch {
    throw new GeminiScanError('network', 'אין חיבור לשרת Gemini');
  }

  if (!response.ok) {
    throw new GeminiScanError('http', `Gemini החזיר שגיאה ${response.status}`, response.status);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new GeminiScanError('bad-response', 'תשובה לא תקינה מ-Gemini');
  }

  const text = extractText(payload);
  if (!text) throw new GeminiScanError('bad-response', 'תשובה ריקה מ-Gemini');

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new GeminiScanError('bad-response', 'תשובה לא תקינה מ-Gemini');
  }

  const scanned = sanitizeScanned(parsed);
  if (isEmptyScan(scanned)) {
    throw new GeminiScanError('unreadable', 'לא זוהה מתכון בתמונה');
  }
  return scanned;
}
