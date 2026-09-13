/// <reference types="node" />
// `.js`, not `.ts`: Vercel compiles each function to JavaScript but leaves import paths as
// written, so a `.ts` specifier crashes at runtime with ERR_MODULE_NOT_FOUND. TypeScript's
// nodenext resolution maps this back to _gemini.ts for type-checking.
import { hasApiKey, scanRecipeImage } from './_gemini.js';

/**
 * Vercel serverless function backing the recipe photo scanner.
 *
 * GET  → `{ configured: boolean }` so the UI knows whether to offer the AI button at all
 *        (the browser can't see GEMINI_API_KEY, which is the entire point).
 * POST → `{ imageBase64, mimeType }` → `{ text }`, the model's JSON reply, parsed and
 *        sanitized client-side by src/lib/geminiScanner.ts.
 *
 * Typed structurally rather than importing `@vercel/node`, to avoid adding a dependency for
 * two type annotations.
 */

type Req = {
  method?: string;
  body?: unknown;
};

type Res = {
  status: (code: number) => Res;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

export default async function handler(req: Req, res: Res): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (req.method === 'GET') {
    // Never cached: whether a key is present can change without the bundle changing.
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ configured: hasApiKey(apiKey) });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method-not-allowed' });
    return;
  }

  // Vercel parses a JSON body for us; a string body (or none) is handled defensively so a
  // malformed request becomes a clean 400 rather than a crash.
  let parsed: unknown = req.body;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      res.status(400).json({ error: 'bad-request' });
      return;
    }
  }

  const reply = await scanRecipeImage(parsed, apiKey);
  res.status(reply.status).json(reply.body);
}
