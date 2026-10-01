/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Crash reporting. Unset (the default, and the case in local development) leaves lib/sentry.ts
   * completely dormant — no client, no network, no behavior change. */
  readonly VITE_SENTRY_DSN?: string;
  /** Build identity for the Sentry `release` tag, and what `min_client_version` is compared
   * against. Nothing injects a real tag yet: CI does not deploy (Vercel builds), so a
   * release tag has to be set as a Vercel env var. */
  readonly VITE_APP_VERSION?: string;
  /** Cloudflare Turnstile **site** key — public by design, and inlined into the bundle. Unset
   * (the default) leaves lib/turnstile.ts completely dormant: no script, no widget, no token.
   * The matching *secret* key goes in the Supabase dashboard, never here. */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
  /** PostHog **project** API key — public by design, inlined into the bundle. Unset (the default)
   * leaves lib/analytics.ts completely dormant: no timer, no listener, no network. */
  readonly VITE_POSTHOG_KEY?: string;
  /** Capture host. Defaults to the EU cloud; a US project needs `https://us.i.posthog.com`, which
   * `vercel.json`'s `connect-src` already covers via `*.i.posthog.com`. */
  readonly VITE_POSTHOG_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
