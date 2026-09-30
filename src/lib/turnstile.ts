/**
 * Cloudflare Turnstile, wired to Supabase's own CAPTCHA support.
 *
 * **Dormant without `VITE_TURNSTILE_SITE_KEY`**, exactly like `sentry.ts` is without a DSN: no
 * script is loaded, no widget renders, and no token is attached to any auth call. That is what
 * makes it safe to land before the dashboard side is configured — and it has to be, because the
 * two halves cannot be switched on in the same instant.
 *
 * Why it belongs here at all: `api/_auth.ts` notes that "signup is open and email confirmation
 * is off, so a valid JWT is worth nothing on its own". That is true, and it is *why* the scan
 * endpoint has to require a membership. Turnstile attacks the same problem one step earlier, by
 * making the JWT itself cost something to obtain.
 *
 * **Switching it on is two changes that must happen in this order:**
 *   1. Supabase dashboard → Authentication → Attack Protection → enable CAPTCHA, provider
 *      Turnstile, paste the *secret* key.
 *   2. Set `VITE_TURNSTILE_SITE_KEY` (the *site* key — this one is public and ends up in the
 *      bundle, which is correct) and redeploy.
 *
 * Doing (2) first means every sign-in sends a token the server ignores: harmless. Doing (1)
 * first means the server demands a token no client is sending: every sign-in, sign-up and
 * password reset fails. Hence the order, and hence `mapAuthError` recognising Supabase's
 * "captcha protection" message so that failure is at least legible if it happens anyway.
 *
 * Note that Supabase's setting is not per-endpoint: enabling it covers sign-up, sign-in **and**
 * password reset together. All three pass a token here for that reason — protecting only signup
 * would break the other two the moment the dashboard switch is flipped.
 */

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const SCRIPT_ID = 'cf-turnstile-script';

export const turnstileSiteKey: string | undefined = import.meta.env.VITE_TURNSTILE_SITE_KEY || undefined;

export const turnstileEnabled = Boolean(turnstileSiteKey);

type TurnstileApi = {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi | null> | null = null;

/**
 * Loads Cloudflare's script once per page and resolves with its API.
 *
 * Resolves with `null` rather than rejecting when the script can't load — a blocked CDN, an
 * offline kitchen, an ad blocker. The caller then renders no widget and sends no token, which
 * degrades to exactly the behaviour before this file existed. A CAPTCHA that cannot load must
 * not be a lock on the door: the people it keeps out are the staff.
 */
export function loadTurnstile(): Promise<TurnstileApi | null> {
  if (!turnstileEnabled || typeof document === 'undefined') return Promise.resolve(null);
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading) return loading;

  loading = new Promise((resolve) => {
    const existing = document.getElementById(SCRIPT_ID);
    const script = (existing as HTMLScriptElement | null) ?? document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => resolve(window.turnstile ?? null), { once: true });
    script.addEventListener('error', () => resolve(null), { once: true });
    if (!existing) document.head.appendChild(script);
  });
  return loading;
}

/** Test seam: `loadTurnstile` memoizes, which is right in a browser and wrong across tests. */
export function resetTurnstileLoader(): void {
  loading = null;
}
