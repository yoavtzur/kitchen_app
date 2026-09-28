/// <reference types="node" />
// `.js`, not `.ts`: Vercel compiles each function to JavaScript but leaves import paths as
// written, so a `.ts` specifier crashes at runtime with ERR_MODULE_NOT_FOUND. TypeScript's
// nodenext resolution maps this back to _gemini.ts for type-checking.
import { handleScanRequest } from './_gemini.js';
import { parseAllowlist, readSupabaseEnv } from './_auth.js';

/**
 * Vercel serverless function backing the recipe photo scanner.
 *
 * GET  → `{ configured: boolean }` so the UI knows whether to offer the AI button at all
 *        (the browser can't see GEMINI_API_KEY, which is the entire point).
 * POST → `{ imageBase64, mimeType }` → `{ text }`, the model's JSON reply, parsed and
 *        sanitized client-side by src/lib/geminiScanner.ts. Requires a Supabase access token;
 *        see `_auth.ts` for why the quota RPC is the authentication check.
 *
 * Every decision lives in `handleScanRequest`, shared with the Vite dev middleware — this file
 * is only the adapter between Vercel's req/res shape and that function.
 *
 * Typed structurally rather than importing `@vercel/node`, to avoid adding a dependency for
 * a handful of type annotations.
 */

type Req = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
};

type Res = {
  status: (code: number) => Res;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

/** Must stay above `_gemini.ts`'s GEMINI_TIMEOUT_MS, so our own timeout fires first and the
 * caller gets a real error code instead of a platform-level 504 with no body. */
export const maxDuration = 30;

function header(req: Req, name: string): string | undefined {
  const value = req.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

export default async function handler(req: Req, res: Res): Promise<void> {
  const reply = await handleScanRequest(
    {
      method: req.method,
      origin: header(req, 'origin'),
      host: header(req, 'host'),
      authorization: header(req, 'authorization'),
      contentLength: header(req, 'content-length'),
      body: req.body,
    },
    {
      geminiApiKey: process.env.GEMINI_API_KEY,
      supabase: readSupabaseEnv(process.env),
      allowedOrigins: parseAllowlist(process.env.SCAN_ALLOWED_ORIGINS),
    },
  );

  for (const [name, value] of Object.entries(reply.headers)) res.setHeader(name, value);
  res.status(reply.status).json(reply.body);
}
