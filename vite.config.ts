import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
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

/**
 * The service worker, whose job here is exactly one thing the sync engine cannot do: serve the
 * app shell — HTML, JS, CSS, fonts — on a **cold offline launch**. Before this, "offline" only
 * ever covered a tab that was already open; a cook opening the app on bad wifi got nothing at
 * all, which undercut the whole point of the offline op queue.
 *
 * ## Why everything network-bound is NetworkOnly, and never NetworkFirst
 *
 * Caching Supabase responses would be actively dangerous, for three reasons in descending
 * severity:
 *
 *  1. `/rest/v1/ops?seq=gt.N` responses are **deltas, not resources** — meaningful only relative
 *     to a `confirmedSeq` the service worker knows nothing about. A cached delta makes
 *     `fetchOpsSince` resolve with a stale empty array, `engine.ts` concludes it is caught up,
 *     and `foldContiguous`'s gap detection — the thing CLAUDE.md calls the actual correctness
 *     guarantee, since "realtime is a latency optimization only" — never fires. That is silent
 *     divergence in the one subsystem this app can least afford to break.
 *  2. NetworkFirst turns a network failure into a 200. `store.ts`'s FETCH_OPS retry loop keys
 *     entirely off the promise **rejecting**; a worker answering from cache disables it.
 *  3. The sync engine already *is* the offline layer. `kitchen-sync-<id>` is a purpose-built,
 *     schema-aware cache with an outbound queue. A generic HTTP cache on top duplicates it with
 *     strictly worse semantics — and `/auth/v1/*` responses carry tokens, which is plainly a
 *     security bug to cache.
 *
 * Realtime is a WebSocket, which service workers do not intercept at all, so there is nothing
 * to configure there.
 *
 * ## Why the new worker waits
 *
 * `skipWaiting` and `clientsClaim` are both off, deliberately. Swapping the controller under a
 * live page whose JavaScript came from the old bundle produces exactly the mismatch that
 * `upgrade-required` exists to prevent. Instead `UpdatePrompt` offers the cook the update and
 * only then reloads.
 */
function kitchenPwa(): Plugin[] {
  return VitePWA({
    registerType: 'prompt',
    // The existing public/manifest.webmanifest stays the single source of truth; generating a
    // second one from here would give us two files to keep in step and no benefit.
    manifest: false,
    // No injected inline registration script: `script-src 'self'` in vercel.json forbids inline
    // script, and the app registers the worker itself from UpdatePrompt.
    injectRegister: null,
    workbox: {
      globPatterns: ['**/*.{js,css,html,woff2,png,svg,webmanifest}'],
      // Every route is /#/something, so the request path is always "/" and one fallback covers
      // the whole app — the payoff of HashRouter, and why there is no SPA-rewrite class of bug
      // here at all.
      navigateFallback: 'index.html',
      navigateFallbackDenylist: [/^\/api\//],
      cleanupOutdatedCaches: true,
      skipWaiting: false,
      clientsClaim: false,
      runtimeCaching: [
        {
          // See the long note above. Listed explicitly rather than relying on the worker simply
          // not matching them, so that the intent survives the next person to add a cache rule.
          urlPattern: ({ url }) => url.hostname.endsWith('.supabase.co') || url.pathname.startsWith('/api/'),
          handler: 'NetworkOnly',
        },
      ],
    },
    devOptions: {
      // A service worker in `npm run dev` caches the very files HMR is trying to replace.
      enabled: false,
    },
  }) as Plugin[];
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // '' loads every variable, including ones without the VITE_ prefix — GEMINI_API_KEY is
  // server-side only and must never be exposed to client code, so it is passed to the dev
  // middleware above rather than being defined into the bundle.
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), scanRecipeDevApi(env), kitchenPwa()],
    build: {
      // 'hidden' emits source maps but writes no sourceMappingURL into the bundle, so no browser
      // or scraper fetches them; Sentry can still symbolicate once Phase 7 adds
      // @sentry/vite-plugin to upload them and `filesToDeleteAfterUpload` to remove them from
      // dist. Until then they are deployed but unreferenced — reachable only by guessing the
      // hashed filename.
      sourcemap: 'hidden',
      // NO manualChunks here, and that is a measured decision rather than an oversight.
      //
      // Splitting `vendor-react` and `vendor-supabase` out sounds obviously right — they are
      // large and almost never change, so a service worker would re-download less on each
      // deploy. Measured on this codebase it is a clear net loss:
      //
      //   no manualChunks       entry 300.95 kB /  95.44 kB gzipped
      //   +vendor-supabase      entry 292.23 kB + 210.38 kB chunk = 146.92 kB gzipped
      //   +react +supabase +sentry                                = 150.20 kB gzipped
      //
      // Moving @supabase/supabase-js into its own chunk shrank the entry by only 8.7 kB while
      // adding a 210 kB chunk: a manual chunk is its own unit whose exports must survive, so
      // Rollup can no longer drop the ~200 kB of that package this app never reaches. Paying
      // 55 kB gzipped on every first load — on kitchen wifi, which is the painful case — to
      // save a re-download on the rare deploy is the wrong trade.
      //
      // Route-level lazy loading (src/routes.tsx) is where the real win is, and it keeps
      // tree-shaking intact because the chunks follow what is actually reachable.
    },
  }
})
