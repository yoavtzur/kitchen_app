// One cosmetic global handler, and deliberately nothing more.
//
// Sentry's browser SDK ships the `globalHandlers` integration ENABLED BY DEFAULT — it already
// listens on `window.onerror` and `unhandledrejection` and reports what it catches. So the
// listener installed here never calls captureException: if it did, every unhandled rejection
// would arrive in Sentry twice. The dedup is structural (only one code path ever reports), not
// heuristic (no fingerprint comparison, no "did I just see this" window).
//
// The counterpart matters just as much: with no DSN, Sentry reports nothing at all, so the
// same unhandled rejection would vanish silently. Hence `installConsoleFallback`, wired by the
// single caller in main.tsx on exactly the branch where Sentry is dormant.
import { sentryEnabled } from './sentry';

type Toast = (message: string) => void;

let showToast: Toast | null = null;

/** Lets the UI register a way to surface a message. Until something does, the listener below
 * still runs — it just has nowhere to draw, which is fine. */
export function setErrorToastHandler(handler: Toast | null): void {
  showToast = handler;
}

const UNEXPECTED = 'משהו השתבש. אם זה חוזר, נסו לרענן את האפליקציה.';

/**
 * Installs the cosmetic rejection listener: it tells the cook something went wrong, and does
 * not report anything. Safe to call regardless of whether Sentry is configured.
 */
export function installErrorUx(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('unhandledrejection', () => {
    showToast?.(UNEXPECTED);
  });
}

/**
 * The other half of the "exactly one reporting path" rule: when Sentry is dormant there is no
 * globalHandlers integration, so nothing would record an unhandled error at all. This logs
 * them, and is installed only on that branch.
 */
export function installConsoleFallback(): void {
  if (typeof window === 'undefined' || sentryEnabled()) return;
  window.addEventListener('error', (event) => {
    console.error('[unhandled error]', event.error ?? event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[unhandled rejection]', event.reason);
  });
}
