/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Crash reporting. Unset (the default, and the case in local development) leaves lib/sentry.ts
   * completely dormant — no client, no network, no behavior change. */
  readonly VITE_SENTRY_DSN?: string;
  /** Build identity for the Sentry `release` tag, and what `min_client_version` is compared
   * against. Phase 7's CI injects a real tag + commit here. */
  readonly VITE_APP_VERSION?: string;
  /** Cloudflare Turnstile **site** key — public by design, and inlined into the bundle. Unset
   * (the default) leaves lib/turnstile.ts completely dormant: no script, no widget, no token.
   * The matching *secret* key goes in the Supabase dashboard, never here. */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
