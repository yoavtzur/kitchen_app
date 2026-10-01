import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp, useSync } from '../store/AppContext';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { mapRpcError } from '../lib/rpcErrors';
import { analyticsAvailable, isOptedOut, setOptedOut } from '../lib/analytics';
import { exportStateAsJson, parseImportedState } from '../store/storage';
import type { ImportSummary } from '../store/importValidation';
import { SCHEMA_VERSION } from '../data/seed';
import { newId } from '../lib/ids';
import { useTimedFlag, useTimedMessage } from '../lib/useTimedFlag';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CookPill } from '../components/CookPill';
import { Toast } from '../components/Toast';
import type { AppState, Cook, MemberRole, RoundTo } from '../types';

type MemberRow = {
  userId: string;
  cookId: string | null;
  role: MemberRole;
  canEditRecipes: boolean;
  canDeleteRecipes: boolean;
};

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
  const { session, membership, signOut, setMemberPermissions, removeMember, rotateJoinCode, deleteMyAccount } =
    useAuth();
  const { isChef } = usePermissions();
  const sync = useSync();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [newCookName, setNewCookName] = useState('');
  const [importError, setImportError] = useState('');
  const [restaurant, setRestaurant] = useState<{ name: string; joinCode: string } | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [permError, setPermError] = useState('');
  const [membersError, setMembersError] = useState('');
  // Initialized during render rather than set from the mount effect: in remote mode the very
  // first paint of this screen genuinely is loading, and deriving that is both more honest and
  // one fewer cascading render than announcing it afterwards.
  const [membersLoading, setMembersLoading] = useState(() => isSupabaseConfigured && Boolean(membership));
  const [copied, flagCopied] = useTimedFlag(1500);
  const [analyticsOptOut, setAnalyticsOptOut] = useState(isOptedOut);
  const [deleteCandidate, setDeleteCandidate] = useState<Cook | null>(null);
  const [removeCandidate, setRemoveCandidate] = useState<MemberRow | null>(null);
  const [removedMessage, showRemovedMessage] = useTimedMessage(1500);
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

  const boundCookIds = new Set(members.map((m) => m.cookId).filter((id): id is string => !!id));

  /** A failed team fetch used to be completely silent: `error` was destructured away, so a
   * chef on a dropped connection saw an empty permissions list and no reason for it — visually
   * identical to "you are the only member". It now reports, and offers a retry.
   *
   * `cancelledRef` covers it too. The old version guarded only the sibling restaurant fetch
   * with `cancelled`, so a slow membership response landing after this screen unmounted called
   * `setMembers` on a dead component. */
  const cancelledRef = useRef(false);

  const reloadMembers = useCallback(() => {
    if (!isSupabaseConfigured || !supabase || !membership) return;
    supabase
      .from('memberships')
      .select('user_id, cook_id, role, can_edit_recipes, can_delete_recipes')
      .eq('restaurant_id', membership.restaurantId)
      .then(({ data, error }) => {
        if (cancelledRef.current) return;
        setMembersLoading(false);
        if (error) {
          setMembersError(mapRpcError(error));
          return;
        }
        setMembers(
          (data ?? []).map((row) => ({
            userId: row.user_id as string,
            cookId: row.cook_id as string | null,
            role: row.role as MemberRole,
            canEditRecipes: Boolean(row.can_edit_recipes),
            canDeleteRecipes: Boolean(row.can_delete_recipes),
          })),
        );
      });
  }, [membership]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !membership) return;
    cancelledRef.current = false;
    supabase
      .from('restaurants')
      .select('name, join_code')
      .eq('id', membership.restaurantId)
      .single()
      .then(({ data }) => {
        if (!cancelledRef.current && data) {
          setRestaurant({ name: data.name as string, joinCode: data.join_code as string });
        }
      });
    reloadMembers();
    return () => {
      cancelledRef.current = true;
    };
  }, [membership, reloadMembers]);

  async function updatePermissions(row: MemberRow, patch: Partial<Pick<MemberRow, 'canEditRecipes' | 'canDeleteRecipes'>>) {
    setPermError('');
    const next = { ...row, ...patch };
    const { error } = await setMemberPermissions(row.userId, next.role, next.canEditRecipes, next.canDeleteRecipes);
    if (error) {
      setPermError(error);
      return;
    }
    reloadMembers();
  }

  async function confirmRemoveMember() {
    if (!removeCandidate) return;
    setPermError('');
    const { error } = await removeMember(removeCandidate.userId);
    if (error) {
      setPermError(error);
      setRemoveCandidate(null);
      return;
    }
    if (removeCandidate.cookId) dispatch({ type: 'REMOVE_COOK', id: removeCandidate.cookId });
    reloadMembers();
    setRemoveCandidate(null);
    showRemovedMessage('הוסר!');
  }

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

  function addCook() {
    if (!newCookName.trim()) return;
    const cook: Cook = {
      id: newId('cook'),
      name: newCookName.trim(),
      color: `hsl(${Math.floor(Math.random() * 360)}, 45%, 40%)`,
    };
    dispatch({ type: 'ADD_COOK', cook });
    setNewCookName('');
  }

  function requestDeleteCook(cook: Cook) {
    if (isSupabaseConfigured && boundCookIds.has(cook.id)) {
      setDeleteCandidate(cook);
      return;
    }
    dispatch({ type: 'DELETE_COOK', id: cook.id });
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
            {restaurant && (
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
                  {isChef && (
                    <button type="button" className="btn" disabled={rotating} onClick={() => setConfirmRotate(true)}>
                      {rotating ? 'מחליף...' : 'החלף קוד'}
                    </button>
                  )}
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

      {isSupabaseConfigured && isChef && (
        <>
          <h2 className="section-title">הרשאות צוות</h2>
          <div className="card stack-gap-2">
            {permError && <p style={{ color: 'var(--color-red)' }}>{permError}</p>}
            {membersLoading && members.length === 0 && <p className="muted">טוען צוות...</p>}
            {membersError && (
              <div className="stack-gap-2">
                <p style={{ color: 'var(--color-red)' }}>טעינת הצוות נכשלה: {membersError}</p>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setMembersError('');
                    setMembersLoading(true);
                    reloadMembers();
                  }}
                >
                  נסה שוב
                </button>
              </div>
            )}
            {members.map((row) => {
              const cook = row.cookId ? state.cooks.find((c) => c.id === row.cookId) : undefined;
              return (
                <div key={row.userId} className="row-item" style={{ alignItems: 'center' }}>
                  <div className="row" style={{ gap: 8, width: 'auto' }}>
                    {cook ? <CookPill cook={cook} /> : <span className="muted">טבח לא משויך</span>}
                  </div>
                  {row.role === 'chef' ? (
                    <span className="pill">שף</span>
                  ) : cook ? (
                    <div className="row" style={{ gap: 12, width: 'auto' }}>
                      <label className="row" style={{ gap: 4, width: 'auto' }}>
                        <input
                          type="checkbox"
                          checked={row.canEditRecipes}
                          onChange={(e) => updatePermissions(row, { canEditRecipes: e.target.checked })}
                          style={{ width: 'auto' }}
                        />
                        עריכת מתכונים
                      </label>
                      <label className="row" style={{ gap: 4, width: 'auto' }}>
                        <input
                          type="checkbox"
                          checked={row.canDeleteRecipes}
                          onChange={(e) => updatePermissions(row, { canDeleteRecipes: e.target.checked })}
                          style={{ width: 'auto' }}
                        />
                        מחיקת מתכונים
                      </label>
                      <button
                        type="button"
                        className="btn btn-icon"
                        aria-label="הסר טבח"
                        onClick={() => setRemoveCandidate(row)}
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div className="row" style={{ gap: 12, width: 'auto' }}>
                      <span className="muted">צריך להתחבר לפני שאפשר להגדיר הרשאות</span>
                      <button
                        type="button"
                        className="btn btn-icon"
                        aria-label="הסר טבח"
                        onClick={() => setRemoveCandidate(row)}
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

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

      <h2 className="section-title">טבחים</h2>
      <div className="card">
        <div className="stack-gap-2" style={{ marginBottom: 'var(--space-3)' }}>
          {state.cooks.map((cook) => (
            <div key={cook.id} className="row-item">
              <CookPill cook={cook} />
              <button type="button" className="btn btn-icon" onClick={() => requestDeleteCook(cook)}>
                ✕
              </button>
            </div>
          ))}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input
            value={newCookName}
            onChange={(e) => setNewCookName(e.target.value)}
            placeholder="שם טבח חדש"
            style={{ flex: 1, border: '1px solid var(--color-border)', borderRadius: 8, padding: '8px' }}
          />
          <button type="button" className="btn btn-primary" onClick={addCook}>
            הוסף
          </button>
        </div>
      </div>

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

      <h2 className="section-title">גיבוי ושחזור</h2>
      <div className="card stack-gap-3">
        <p className="muted">
          {isSupabaseConfigured
            ? 'הנתונים מסונכרנים בין כל המכשירים במטבח. מומלץ לגבות מעת לעת.'
            : 'כל הנתונים שמורים בדפדפן הזה בלבד. מומלץ לגבות מעת לעת.'}
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

      {deleteCandidate && (
        <ConfirmDialog
          title="מחיקת טבח"
          confirmLabel="מחק בכל זאת"
          onClose={() => setDeleteCandidate(null)}
          onConfirm={() => {
            dispatch({ type: 'DELETE_COOK', id: deleteCandidate.id });
            setDeleteCandidate(null);
          }}
        >
          <p>
            "{deleteCandidate.name}" משויך לחשבון פעיל של אחד המשתמשים. מחיקתו לא תסיר את החשבון, אבל הוא ייאלץ לבחור
            את עצמו מחדש.
          </p>
        </ConfirmDialog>
      )}

      {removeCandidate && (
        <ConfirmDialog
          title="הסרת טבח מהמסעדה"
          confirmLabel="הסר לצמיתות"
          destructive
          onClose={() => setRemoveCandidate(null)}
          onConfirm={confirmRemoveMember}
        >
          <p>
            האם אתה בטוח שברצונך להסיר את{' '}
            {removeCandidate.cookId ? state.cooks.find((c) => c.id === removeCandidate.cookId)?.name : 'טבח לא משויך'}?
            הפעולה תמחק את הגישה שלו למסעדה לצמיתות, אך היסטוריית המשימות שבוצעו תישמר.
          </p>
        </ConfirmDialog>
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

      {/* At the end of the screen rather than inside the team card that triggers it: Settings is
          long enough that the card is usually scrolled past by the time the removal returns. */}
      {removedMessage && <Toast message={removedMessage} />}
      {importedMessage && <Toast message={importedMessage} />}
      {rotatedMessage && <Toast message={rotatedMessage} />}
    </div>
  );
}
