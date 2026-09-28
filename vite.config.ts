import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { handleScanRequest, MAX_BODY_BYTES as MAX_SCAN_BODY_BYTES } from './api/_gemini.ts'
import { parseAllowlist, readSupabaseEnv } from './api/_auth.ts'

/**
 * Serves `/api/scan-recipe` during `npm run dev`.
 *
 * In production that path is a real Vercel serverless function (`api/scan-recipe.ts`); the
 * Vite dev server knows nothing about those, so without this the scanner would only work
 * after deploying. Both are thin adapters over the same `handleScanRequest`, so dev and prod
 * cannot drift on authorization, quota, or any other guard.
 */
function scanRecipeDevApi(env: Record<string, string>): Plugin {
  return {
    name: 'scan-recipe-dev-api',
    apply: 'serve',
    configureServer(server) {
      // loadEnv reads .env.local; process.env covers a variable exported in the shell.
      const merged = { ...process.env, ...env } as Record<string, string | undefined>

      server.middlewares.use('/api/scan-recipe', (req, res) => {
        // Refuse an oversized body from the header alone, before buffering a byte of it.
        // Vercel enforces its own body cap ahead of the function, so without this the dev
        // server would be the one place that happily read a gigabyte into memory — and a
        // Content-Length guard that only runs after the buffering is finished guards nothing.
        const declared = Number(req.headers['content-length'])
        if (Number.isFinite(declared) && declared > MAX_SCAN_BODY_BYTES) {
          res.statusCode = 413
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'too-large' }))
          req.destroy()
          return
        }

        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer) => chunks.push(chunk))
        req.on('end', async () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          const reply = await handleScanRequest(
            {
              method: req.method,
              origin: req.headers.origin,
              host: req.headers.host,
              authorization: req.headers.authorization,
              contentLength: req.headers['content-length'],
              // Left as a string: handleScanRequest parses it, so a malformed body produces the
              // same 400 here as it does in production rather than a different one.
              body: raw || undefined,
            },
            {
              geminiApiKey: merged.GEMINI_API_KEY,
              supabase: readSupabaseEnv(merged),
              allowedOrigins: parseAllowlist(merged.SCAN_ALLOWED_ORIGINS),
            },
          )
          res.statusCode = reply.status
          res.setHeader('Content-Type', 'application/json')
          for (const [name, value] of Object.entries(reply.headers)) res.setHeader(name, value)
          res.end(JSON.stringify(reply.body))
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // '' loads every variable, including ones without the VITE_ prefix — GEMINI_API_KEY is
  // server-side only and must never be exposed to client code, so it is passed to the dev
  // middleware above rather than being defined into the bundle.
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), scanRecipeDevApi(env)],
  }
})
