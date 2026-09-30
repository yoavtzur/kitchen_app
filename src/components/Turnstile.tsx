import { useEffect, useRef } from 'react';
import { loadTurnstile, turnstileEnabled, turnstileSiteKey } from '../lib/turnstile';

type Props = {
  /** Called with a fresh token, or `null` when the widget expires or errors. */
  onToken: (token: string | null) => void;
  /**
   * Bump to force a new challenge. A Turnstile token is **single use**: Supabase consumes it on
   * the failed attempt too, so retrying with the same token fails with a captcha error rather
   * than the real reason (usually "wrong password"), and the user sees the wrong message
   * forever. Every caller resets this after a failed submit.
   *
   * Declarative rather than an imperative handle, matching `ErrorBoundary`'s `resetKeys`.
   */
  resetKey?: number;
};

/**
 * Renders nothing at all unless `VITE_TURNSTILE_SITE_KEY` is set — see `lib/turnstile.ts` for
 * why that is the whole point of how this is wired.
 */
export function Turnstile({ onToken, resetKey = 0 }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Held in refs, not state: neither is rendered, and re-rendering on a token would tear the
  // widget down and re-render it into a fresh host node mid-challenge.
  const widgetRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  // Updated in an effect rather than during render: writing a ref while rendering is what the
  // `react(refs)` lint rule is about, and it is genuinely wrong under a render React may throw
  // away. No dependency array, so the latest callback is in place before any challenge resolves.
  useEffect(() => {
    onTokenRef.current = onToken;
  });

  useEffect(() => {
    if (!turnstileEnabled) return;
    let cancelled = false;

    loadTurnstile().then((api) => {
      if (cancelled || !api || !hostRef.current) {
        // Script blocked or unreachable: no widget, no token, and auth proceeds as before.
        return;
      }
      widgetRef.current = api.render(hostRef.current, {
        sitekey: turnstileSiteKey,
        // The kitchen app is RTL and Hebrew throughout; the widget should not be the one English
        // island on the sign-in screen.
        language: 'he',
        callback: (token: string) => onTokenRef.current(token),
        'expired-callback': () => onTokenRef.current(null),
        'error-callback': () => onTokenRef.current(null),
      });
    });

    return () => {
      cancelled = true;
      const id = widgetRef.current;
      widgetRef.current = null;
      if (id && window.turnstile) window.turnstile.remove(id);
    };
  }, []);

  useEffect(() => {
    if (!resetKey) return;
    const id = widgetRef.current;
    if (id && window.turnstile) {
      window.turnstile.reset(id);
      onTokenRef.current(null);
    }
  }, [resetKey]);

  if (!turnstileEnabled) return null;
  return <div ref={hostRef} style={{ display: 'flex', justifyContent: 'center' }} />;
}
