import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// A viewer can force local-only mode even on a fully-configured build (useful for testing local
// mode without unsetting env vars and redeploying). Never the other way around — there is no
// way to turn ON remote mode without real env vars, since there's nothing to talk to.
const forcedLocal =
  typeof localStorage !== 'undefined' && localStorage.getItem('kitchen-force-local') === '1';

/** Whether a Supabase project is configured for this build. `false` means: no `.env.local` (or
 * no env vars set on the Vercel deployment), or the user explicitly forced local mode. Every
 * screen and the sync engine behave identically either way — see AppContext.tsx. */
export const isSupabaseConfigured = Boolean(url && key) && !forcedLocal;

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, key!, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'kitchen-auth' },
      realtime: { params: { eventsPerSecond: 5 } },
    })
  : null;
