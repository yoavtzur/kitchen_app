import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp, useSync } from '../store/AppContext';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { mapRpcError } from '../lib/rpcErrors';
import { useTeamMembers } from '../auth/useTeamMembers';
import { analyticsAvailable, isOptedOut, setOptedOut } from '../lib/analytics';
import { exportStateAsJson, parseImportedState } from '../store/storage';
import type { ImportSummary } from '../store/importValidation';
import { SCHEMA_VERSION } from '../data/seed';
import { useTimedFlag, useTimedMessage } from '../lib/useTimedFlag';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Toast } from '../components/Toast';
import type { AppState, RoundTo } from '../types';
import { todayStr } from '../lib/date';

const ROUND_OPTIONS: { value: string; label: string }[] = [
  { value: 'none', label: 'ללא עיגול' },
  { value: '0.25', label: 'רבעים (0.25)' },
  { value: '0.5', label: 'חצאים (0.5)' },
  { value: '1', label: 'שלמים (1)' },
];

const SYNC_STATUS_LABEL: Record<string, string> = {
  boot: 'טוען...',
  syncing: 'מסנכרן...',
  live: 'מסונכרן',
  offline: 'לא מקוון',
  error: 'שגיאת סנכרון',
  'upgrade-required': 'יש לרענן את האפליקציה',
  'read-only': 'קריאה בלבד — שינויים לא נשלחים',
};

export function Settings() {
  const { state, dispatch } = useApp();
  const { session, membership, signOut, rotateJoinCode, deleteMyAccount } = useAuth();
  const { isChef } = usePermissions();
  const sync = useSync();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState('');
  const [excelState, setExcelState] = useState<'idle' | 'working' | 'error'>('idle');
  const [restaurant, setRestaurant] = useState<{ name: string; joinCode: string } | null>(null);
  // Only the headcount matters here — whether the caller is the last member, for the deletion
  // warning. The team itself is managed on its own screen (see Team.tsx).
  const { members } = useTeamMembers();
  const [copied, flagCopied] = useTimedFlag(1500);
  const [analyticsOptOut, setAnalyticsOptOut] = useState(isOptedOut);
  const [importCandidate, setImportCandidate] = useState<{ state: AppState; summary: ImportSummary } | null>(null);
  const [importing, setImporting] = useState(false);
  const [importedMessage, showImportedMessage] = useTimedMessage(2000);
  const [rotating, setRotating] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteTyped, setDeleteTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [rotatedMessage, showRotatedMessage] = useTimedMessage(2500);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !membership) return;
    let cancelled = false;
    supabase
      .from('restaurants')
      .select('name, join_code')
      .eq('id', membership.restaurantId)
      .single()
      .then(({ data }) => {
        if (!cancelled && data) {
          setRestaurant({ name: data.name as string, joinCode: data.join_code as string });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [membership]);

  function handleExport() {
    const json = exportStateAsJson(state);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kitchen-backup-${state.settings.weekStartsOn}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** A readable workbook for the chef (lib/excelExport.ts). Loaded on demand: the writer and its zip
   * dependency are not worth a byte of the app's first load. */
  async function handleExcelExport() {
    setExcelState('working');
    try {
      const [{ buildExportSheets, exportFileName }, { toXlsx }] = await Promise.all([
        import('../lib/excelExport'),
        import('../lib/xlsx'),
      ]);
      const bytes = toXlsx(buildExportSheets(state));
      const blob = new Blob([bytes as BlobPart], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = exportFileName(todayStr());
      a.click();
      // Revoked a moment later: Safari starts the download asynchronously and a URL revoked in the
      // same tick can come out as an empty file.
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setExcelState('idle');
    } catch (err) {
      console.error('excel export failed', err);
      setExcelState('error');
    }
  }

  /** Parses and validates, but commits nothing: an import replaces everything, so it goes
   * through a confirmation showing what is in the file first. See `store/importValidation.ts`
   * for why a file that doesn't validate is refused outright rather than partly applied. */
  function handleImportFile(file: File) {
    setImportError('');
    file
      .text()
      .then((text) => {
        const result = parseImportedState(text);
        if (!result.ok) {
          setImportError(result.error);
          return;
        }
        setImportCandidate({ state: result.state, summary: result.summary });
      })
      .catch(() => setImportError('לא ניתן לקרוא את הקובץ.'));
  }

  async function confirmImport() {
    if (!importCandidate) return;
    const { state: imported } = importCandidate;
    setImportCandidate(null);
    if (isSupabaseConfigured && supabase && membership) {
      setImporting(true);
      const { error } = await supabase.rpc('reset_snapshot', {
        p_restaurant_id: membership.restaurantId,
        p_snapshot: imported,
        p_schema_version: SCHEMA_VERSION,
      });
      setImporting(false);
      if (error) setImportError(mapRpcError(error));
      else showImportedMessage('הגיבוי שוחזר ✓');
      return;
    }
    dispatch({ type: 'IMPORT_STATE', state: imported });
    showImportedMessage('הגיבוי שוחזר ✓');
  }

  /** Replacing the code is what makes it possible to remove someone's access to the kitchen
   * without deleting their account — the old code stops working the instant this returns. */
  async function doRotateJoinCode() {
    setConfirmRotate(false);
    setAccountError('');
    setRotating(true);
    const { code, error } = await rotateJoinCode();
    setRotating(false);
    if (error) {
      setAccountError(error);
      return;
    }
    if (code) setRestaurant((prev) => (prev ? { ...prev, joinCode: code } : prev));
    showRotatedMessage('קוד חדש נוצר ✓');
  }

  /** On success this never returns to render: deleteMyAccount wipes local storage and reloads. */
  async function doDeleteAccount() {
    setAccountError('');
    setDeleting(true);
    const { error } = await deleteMyAccount();
    setDeleting(false);
    if (error) {
      setAccountError(error);
      setConfirmDelete(false);
      setDeleteTyped('');
    }
  }

  async function copyJoinCode() {
    if (!restaurant) return;
    try {
      await navigator.clipboard.writeText(restaurant.joinCode);
      flagCopied();
    } catch {
      // clipboard unavailable — the code is still shown on screen to copy by hand
    }
  }

  const roundValue = state.settings.roundMultiplierTo === null ? 'none' : String(state.settings.roundMultiplierTo);

  return (
    <div>
      <div className="screen-header">
        <h1 className="screen-title">הגדרות</h1>
      </div>

      {isSupabaseConfigured && (
        <>
          <h2 className="section-title">המטבח שלי</h2>
          <div className="card stack-gap-3">
            {session?.user.email && (
              <div className="row-item">
                <span className="muted">מחובר כ</span>
                <span>{session.user.email}</span>
              </div>
            )}
            {/* The join code is the key to the kitchen: a cook has no business reading it off
                their own settings screen. */}
            {restaurant && isChef && (
              <div className="row-item">
                <span className="muted">קוד הצטרפות</span>
                <div className="row" style={{ gap: 8, width: 'auto', alignItems: 'center' }}>
                  <button
                    type="button"
                    className="pill"
                    style={{
                      letterSpacing: 2,
                      background: 'transparent',
                      border: '1px solid var(--color-border)',
                      cursor: 'pointer',
                    }}
                    onClick={copyJoinCode}
                  >
                    {copied ? 'הועתק!' : restaurant.joinCode}
                  </button>
                  <button type="button" className="btn" disabled={rotating} onClick={() => setConfirmRotate(true)}>
                    {rotating ? 'מחליף...' : 'החלף קוד'}
                  </button>
                </div>
              </div>
            )}
            <div className="row-item">
              <span className="muted">סנכרון</span>
              <span>
                {SYNC_STATUS_LABEL[sync.status] ?? sync.status}
                {sync.pendingCount > 0 ? ` · ${sync.pendingCount} ממתינים` : ''}
              </span>
            </div>
            {sync.lastError && <p style={{ color: 'var(--color-red)' }}>{sync.lastError}</p>}
            {sync.stalePendingMinutes !== undefined && (
              <p style={{ color: 'var(--color-red)' }}>
                השינויים לא נשלחים כבר {sync.stalePendingMinutes} דקות. בדקו את החיבור לאינטרנט.
              </p>
            )}
            <button type="button" className="btn" onClick={() => signOut()}>
              התנתקות
            </button>
          </div>
        </>
      )}

      {isChef && (
        <>
      <h2 className="section-title">חישוב</h2>
      <div className="card stack-gap-3">
        <div className="field" style={{ marginBottom: 0 }}>
          <label>ימי כיסוי ברירת מחדל</label>
          <input
            type="number"
            inputMode="decimal"
            value={state.settings.defaultCoverageDays}
            onChange={(e) =>
              dispatch({ type: 'UPDATE_SETTINGS', settings: { defaultCoverageDays: parseFloat(e.target.value) || 1 } })
            }
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>עיגול כפולות מתכון</label>
          <select
            value={roundValue}
            onChange={(e) => {
              const v = e.target.value;
              const roundMultiplierTo: RoundTo = v === 'none' ? null : (parseFloat(v) as RoundTo);
              dispatch({ type: 'UPDATE_SETTINGS', settings: { roundMultiplierTo } });
            }}
          >
            {ROUND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

        </>
      )}

      <h2 className="section-title">פרטיות וחשבון</h2>
      <div className="card stack-gap-3">
        <div className="row" style={{ gap: 8 }}>
          <Link className="btn" style={{ flex: 1, textAlign: 'center' }} to="/legal/privacy">
            מדיניות פרטיות
          </Link>
          <Link className="btn" style={{ flex: 1, textAlign: 'center' }} to="/legal/terms">
            תנאי שימוש
          </Link>
        </div>
        {analyticsAvailable(isSupabaseConfigured) && (
          <label className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
            <input
              type="checkbox"
              checked={!analyticsOptOut}
              onChange={(e) => {
                setOptedOut(!e.target.checked);
                setAnalyticsOptOut(!e.target.checked);
              }}
            />
            <span>
              שיתוף סטטיסטיקות שימוש אנונימיות
              <span className="muted" style={{ display: 'block' }}>
                אילו מסכים נפתחים ואילו פעולות מבוצעות — לעולם לא שמות, כמויות או תוכן של המטבח.
              </span>
            </span>
          </label>
        )}
        {accountError && <p style={{ color: 'var(--color-red)' }}>{accountError}</p>}
        {isSupabaseConfigured && session && (
          <>
            <p className="muted">
              מחיקת החשבון מסירה לצמיתות את כתובת האימייל והסיסמה שלכם. אם אתם האחרונים במטבח — גם נתוני המטבח
              יימחקו. מומלץ לייצא גיבוי קודם.
            </p>
            <button type="button" className="btn btn-danger" disabled={deleting} onClick={() => setConfirmDelete(true)}>
              {deleting ? 'מוחק...' : 'מחיקת החשבון'}
            </button>
          </>
        )}
      </div>

      {isChef && (
        <>
      <h2 className="section-title">גיבוי ושחזור</h2>
      <div className="card stack-gap-3">
        <p className="muted">
          {isSupabaseConfigured
            ? 'הנתונים מסונכרנים בין כל המכשירים במטבח. מומלץ לגבות מעת לעת.'
            : 'כל הנתונים שמורים בדפדפן הזה בלבד. מומלץ לגבות מעת לעת.'}
        </p>
        <button type="button" className="btn btn-block" disabled={excelState === 'working'} onClick={handleExcelExport}>
          {excelState === 'working' ? 'מכין קובץ...' : 'ייצוא לאקסל'}
        </button>
        {excelState === 'error' && <p style={{ color: 'var(--color-red)' }}>הייצוא נכשל. נסו שוב.</p>}
        <p className="muted">
          קובץ אקסל לקריאה: מצרכים, מוצרים, מתכונים, הזמנות, יומן זריקות וספקים. זמין לשף בלבד. לשחזור
          האפליקציה משתמשים בגיבוי.
        </p>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn" style={{ flex: 1 }} onClick={handleExport}>
            ייצוא גיבוי
          </button>
          <button
            type="button"
            className="btn"
            style={{ flex: 1 }}
            disabled={importing}
            onClick={() => fileInputRef.current?.click()}
          >
            {importing ? 'משחזר...' : 'ייבוא גיבוי'}
          </button>
        </div>
        {importError && <p style={{ color: 'var(--color-red)' }}>{importError}</p>}
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImportFile(file);
            e.target.value = '';
          }}
        />
      </div>
        </>
      )}

      {confirmRotate && (
        <ConfirmDialog
          title="החלפת קוד ההצטרפות"
          confirmLabel="צור קוד חדש"
          destructive
          onClose={() => setConfirmRotate(false)}
          onConfirm={doRotateJoinCode}
        >
          <p>
            הקוד הנוכחי יפסיק לעבוד מיד. טבחים שכבר הצטרפו אינם מושפעים — אבל כל מי שקיבל את הקוד ועדיין לא הצטרף
            יצטרך את הקוד החדש.
          </p>
        </ConfirmDialog>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="מחיקת החשבון"
          confirmLabel="מחק את החשבון"
          destructive
          // Typing the address is the friction this deserves: the action is irreversible, it can
          // take a whole restaurant's data with it, and there is no copy to restore from.
          confirmDisabled={deleteTyped.trim().toLowerCase() !== (session?.user.email ?? '').toLowerCase()}
          onClose={() => {
            setConfirmDelete(false);
            setDeleteTyped('');
          }}
          onConfirm={doDeleteAccount}
        >
          <p>
            הפעולה אינה הפיכה. החשבון, כתובת האימייל והסיסמה יימחקו לצמיתות
            {members.length <= 1 ? ', ויחד איתם כל נתוני המטבח' : ''}.
          </p>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="delete-confirm-email">להמשך, הקלידו את כתובת האימייל שלכם</label>
            <input
              id="delete-confirm-email"
              type="email"
              autoComplete="off"
              value={deleteTyped}
              onChange={(e) => setDeleteTyped(e.target.value)}
              placeholder={session?.user.email ?? ''}
            />
          </div>
        </ConfirmDialog>
      )}

      {importCandidate && (
        <ConfirmDialog
          title="שחזור גיבוי"
          confirmLabel="שחזר והחלף הכל"
          destructive
          onClose={() => setImportCandidate(null)}
          onConfirm={confirmImport}
        >
          <p>
            {isSupabaseConfigured
              ? 'הגיבוי יחליף את כל הנתונים של המטבח — בכל המכשירים, לא רק בזה. לא ניתן לבטל את הפעולה.'
              : 'הגיבוי יחליף את כל הנתונים השמורים בדפדפן הזה. לא ניתן לבטל את הפעולה.'}
          </p>
          <p className="muted">
            בקובץ: {importCandidate.summary.ingredients} מצרכים · {importCandidate.summary.products} מוצרים ·{' '}
            {importCandidate.summary.recipes} מתכונים · {importCandidate.summary.cooks} טבחים
          </p>
          {importCandidate.summary.fromVersion < SCHEMA_VERSION && (
            <p className="muted">
              הגיבוי נוצר בגרסה ישנה יותר (גרסה {importCandidate.summary.fromVersion}) ויעודכן אוטומטית בשחזור.
            </p>
          )}
        </ConfirmDialog>
      )}

      {/* At the end of the screen rather than inside the card that triggers it: Settings is long
          enough that the card is usually scrolled past by the time the action returns. */}
      {importedMessage && <Toast message={importedMessage} />}
      {rotatedMessage && <Toast message={rotatedMessage} />}
    </div>
  );
}
