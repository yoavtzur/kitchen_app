/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Crash reporting. Unset (the default, and the case in local development) leaves lib/sentry.ts
   * completely dormant — no client, no network, no behavior change. */
  readonly VITE_SENTRY_DSN?: string;
  /** Build identity for the Sentry `release` tag. Phase 6 injects a real tag + commit here. */
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
