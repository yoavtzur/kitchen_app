import { useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ErrorBoundary, type ErrorFallbackProps } from './ErrorBoundary';

/**
 * Wraps **one route's element** — never `<Routes>` itself.
 *
 * That distinction is the whole design. `BottomNav` and `SyncBadge` are *siblings* of `<Routes>`
 * in `App.tsx`, not children, so they survive any crash automatically as long as the boundary
 * stays below the router. A boundary placed around `<Routes>` would leave the router with
 * nothing to render: the nav would still be on screen, but every tap would land on a dead tree,
 * which is strictly worse than no boundary at all.
 *
 * `pathname` is passed as a reset key, so navigating to another tab clears the error rather
 * than leaving the app stuck behind it until a reload.
 */
export function RouteBoundary({ name, children }: { name: string; children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary boundary={name} resetKeys={[pathname]} fallback={(props) => <ScreenError {...props} />}>
      {children}
    </ErrorBoundary>
  );
}

/** Deliberately much smaller than `CrashScreen`: the rest of the app is demonstrably fine (the
 * nav is right there and works), so this offers retry and gets out of the way rather than
 * presenting the full reset ladder for one bad screen. */
function ScreenError({ reset, eventId }: ErrorFallbackProps) {
  return (
    <div>
      <div className="screen-header">
        <h1 className="screen-title">המסך הזה נתקע</h1>
      </div>
      <div className="card stack-gap-3">
        <p>אפשר לנסות שוב, או לעבור למסך אחר מהתפריט למטה — שאר האפליקציה ממשיכה לעבוד.</p>
        <button type="button" className="btn btn-primary" onClick={reset}>
          נסה שוב
        </button>
        {eventId && <p className="muted">מזהה תקלה: {eventId}</p>}
      </div>
    </div>
  );
}
