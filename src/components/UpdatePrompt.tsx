import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * "A new version is ready" — and the only thing that registers the service worker.
 *
 * Rendered **outside every gate** (see App.tsx), on purpose: a cook stuck behind a broken
 * bundle on the sign-in screen is exactly who most needs to be offered the update, and a
 * prompt that only appears once you are past auth would never reach them.
 *
 * The worker itself waits rather than taking over (`skipWaiting: false`, see vite.config.ts),
 * so the swap only happens when the cook presses the button and the page reloads with matching
 * HTML and JavaScript. A worker that claimed the page immediately would leave a live page
 * running old JavaScript against a new bundle — the exact mismatch `upgrade-required` exists
 * to prevent.
 *
 * Sits on the opposite inline edge from `.sync-badge` at the same `bottom`, so the two can
 * never cover each other.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      // A kitchen tablet is plugged in on a shelf and never reloaded, so nothing else would
      // ever notice a new deploy. Hourly, plus whenever it comes back to the foreground.
      const check = () => {
        registration.update().catch(() => {
          // offline, or the server is down — the next tick tries again
        });
      };
      setInterval(check, 60 * 60 * 1000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    },
  });

  const [updating, setUpdating] = useState(false);

  // Debounced for the same reason SyncBadge is: a banner that flashes during a routine
  // registration is noise, and this one asks for an action. `visible` is derived rather than
  // set in the effect, so nothing is written to state synchronously on mount.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!needRefresh) return;
    const t = setTimeout(() => setSettled(true), 1000);
    return () => clearTimeout(t);
  }, [needRefresh]);

  if (!needRefresh || !settled) return null;

  return (
    <div className="update-prompt" role="status">
      <span>יש גרסה חדשה</span>
      <button
        type="button"
        className="btn btn-primary"
        disabled={updating}
        onClick={() => {
          setUpdating(true);
          updateServiceWorker(true);
        }}
      >
        {updating ? 'מעדכן...' : 'עדכנו'}
      </button>
    </div>
  );
}
