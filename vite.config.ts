import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { hasApiKey, scanRecipeImage } from './api/_gemini.ts'

/**
 * Serves `/api/scan-recipe` during `npm run dev`.
 *
 * In production that path is a real Vercel serverless function (`api/scan-recipe.ts`); the
 * Vite dev server knows nothing about those, so without this the scanner would only work
 * after deploying. Both paths call the same `scanRecipeImage`, so dev and prod can't drift.
 */
function scanRecipeDevApi(env: Record<string, string>): Plugin {
  return {
    name: 'scan-recipe-dev-api',
    apply: 'serve',
    configureServer(server) {
      // loadEnv reads .env.local; process.env covers a key exported in the shell.
      const apiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY

      server.middlewares.use('/api/scan-recipe', (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Cache-Control', 'no-store')
          res.end(JSON.stringify(body))
        }

        if (req.method === 'GET') {
          send(200, { configured: hasApiKey(apiKey) })
          return
        }
        if (req.method !== 'POST') {
          send(405, { error: 'method-not-allowed' })
          return
        }

        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer) => chunks.push(chunk))
        req.on('end', async () => {
          let parsed: unknown
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          } catch {
            send(400, { error: 'bad-request' })
            return
          }
          const reply = await scanRecipeImage(parsed, apiKey)
          send(reply.status, reply.body)
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
