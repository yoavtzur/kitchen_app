import { useState } from 'react';
import type { ErrorFallbackProps } from './ErrorBoundary';
import { ResetDataControls } from './ResetDataControls';

/**
 * The root-level fallback: what a cook sees instead of a white screen.
 *
 * **Calls no app hook.** Not `useApp`, not `useAuth`, not `useSync` — if the root boundary
 * caught something, any one of those providers may be exactly what threw, and a fallback that
 * re-enters the broken tree crashes the fallback too. Everything it needs it reads directly:
 * localStorage through `resetLocalData`, Supabase through the module singleton. The styling
 * leans only on global.css classes, which are loaded from `main.tsx` before `App` renders at
 * all.
 */
export function CrashScreen({ eventId }: ErrorFallbackProps) {
  return (
    <div className="app-shell">
      <main className="app-main">
        <div className="screen-header">
          <h1 className="screen-title">משהו השתבש</h1>
        </div>
        <div className="card stack-gap-3">
          <p>
            האפליקציה נתקלה בתקלה בלתי צפויה. הנתונים של המטבח לא נפגעו — ברוב המקרים רענון פשוט פותר את הבעיה.
          </p>
          <p className="muted">
            אם התקלה חוזרת, נסו את האפשרויות מלמעלה למטה. כל אפשרות מסבירה בדיוק מה היא מוחקת לפני שהיא מבצעת.
          </p>
          <ResetDataControls />
          {eventId && <EventId id={eventId} />}
        </div>
      </main>
    </div>
  );
}

/** The report id, copyable. A support conversation that starts with a number instead of a
 * description is a different conversation. */
function EventId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="row-item">
      <span className="muted">מזהה תקלה</span>
      <button
        type="button"
        className="pill"
        style={{ background: 'transparent', border: '1px solid var(--color-border)', cursor: 'pointer' }}
        onClick={() => {
          navigator.clipboard?.writeText(id).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            },
            () => {
              // clipboard blocked — the id is on screen to copy by hand, same as the join code
            },
          );
        }}
      >
        {copied ? 'הועתק!' : id}
      </button>
    </div>
  );
}
