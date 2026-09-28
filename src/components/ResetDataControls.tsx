import { useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  clearSyncCaches,
  fullReset,
  hasLocalOnlyState,
  LOCAL_STATE_KEY,
  softReset,
  unsentOpCount,
} from '../lib/resetLocalData';
import { ConfirmDialog } from './ConfirmDialog';

/**
 * The three recovery tiers, rendered as buttons. Used by the crash screen — so, like the crash
 * screen itself, this component calls **no app hook**: not `useApp`, not `useAuth`, not
 * `useSync`. Those providers are exactly what may have crashed. Sign-out goes through the
 * `supabase` module singleton directly, and the local-mode backup is read as raw bytes out of
 * localStorage rather than out of a store that might not exist.
 */
export function ResetDataControls() {
  const [confirming, setConfirming] = useState<'sync' | 'full' | null>(null);
  const [busy, setBusy] = useState(false);
  const localOnly = hasLocalOnlyState() && !supabase;

  function run(action: () => Promise<void>) {
    setBusy(true);
    // Each of these ends in a reload, so there is no "finally setBusy(false)" — the button
    // staying disabled until the page goes away is the correct end state.
    action().catch(() => setBusy(false));
  }

  /** Downloads the local-mode state exactly as stored, before tier 3 destroys it. Raw bytes on
   * purpose: no parsing, no migration, nothing that can itself throw while the app is already
   * in a crashed state. */
  function downloadLocalBackup() {
    try {
      const raw = localStorage.getItem(LOCAL_STATE_KEY);
      if (!raw) return;
      const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `kitchen-backup-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // Nothing useful to say here — the confirm dialog already warns the data will be lost.
    }
  }

  return (
    <>
      <div className="stack-gap-2">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(softReset)}>
          רענון
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => setConfirming('sync')}>
          ניקוי מטמון מקומי
        </button>
        <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setConfirming('full')}>
          איפוס מלא ויציאה
        </button>
      </div>

      {confirming === 'sync' && <ClearSyncCacheDialog onClose={() => setConfirming(null)} onConfirm={() => run(clearSyncCaches)} />}

      {confirming === 'full' && (
        <ConfirmDialog
          title="איפוס מלא ויציאה"
          confirmLabel="אפס הכול"
          destructive
          onClose={() => setConfirming(null)}
          onConfirm={() => run(() => fullReset(() => supabase?.auth.signOut().then(() => undefined) ?? Promise.resolve()))}
        >
          {localOnly ? (
            <>
              <p>
                האפליקציה פועלת במצב מקומי, וכל נתוני המטבח שמורים בדפדפן הזה בלבד. איפוס מלא ימחק אותם לצמיתות — אין
                עותק בשרת.
              </p>
              <button type="button" className="btn" onClick={downloadLocalBackup}>
                הורדת גיבוי לפני האיפוס
              </button>
            </>
          ) : (
            <p>
              הפעולה תנתק אתכם מהחשבון ותמחק את כל הנתונים השמורים בדפדפן הזה. הנתונים של המסעדה שמורים בשרת ויחזרו
              אחרי התחברות מחדש.
            </p>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}

/** Split out purely so the unsent-op count is read when the dialog opens, not on every render
 * of the crash screen behind it. */
function ClearSyncCacheDialog({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => void }) {
  const [unsent] = useState(unsentOpCount);
  return (
    <ConfirmDialog title="ניקוי מטמון מקומי" confirmLabel="נקה" destructive={unsent > 0} onClose={onClose} onConfirm={onConfirm}>
      <p>
        הפעולה תמחק את העותק המקומי ותטען את הנתונים מחדש מהשרת. תישארו מחוברים.
      </p>
      {unsent > 0 && (
        <p style={{ color: 'var(--color-red)' }}>
          שימו לב: {unsent} שינויים עדיין לא נשלחו לשרת ויאבדו.
        </p>
      )}
    </ConfirmDialog>
  );
}
