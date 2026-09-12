import { useEffect, useRef, useState } from 'react';
import { useApp, useSync } from '../store/AppContext';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { exportStateAsJson, parseImportedState } from '../store/storage';
import { SCHEMA_VERSION } from '../data/seed';
import { newId } from '../lib/ids';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CookPill } from '../components/CookPill';
import type { Cook, MemberRole, RoundTo } from '../types';

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
};

export function Settings() {
  const { state, dispatch } = useApp();
  const { session, membership, signOut, setMemberPermissions, removeMember } = useAuth();
  const { isChef } = usePermissions();
  const sync = useSync();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [newCookName, setNewCookName] = useState('');
  const [importError, setImportError] = useState('');
  const [restaurant, setRestaurant] = useState<{ name: string; joinCode: string } | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [permError, setPermError] = useState('');
  const [copied, setCopied] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<Cook | null>(null);
  const [removeCandidate, setRemoveCandidate] = useState<MemberRow | null>(null);
  const [removedMessage, setRemovedMessage] = useState('');

  const boundCookIds = new Set(members.map((m) => m.cookId).filter((id): id is string => !!id));

  function reloadMembers() {
    if (!isSupabaseConfigured || !supabase || !membership) return;
    supabase
      .from('memberships')
      .select('user_id, cook_id, role, can_edit_recipes, can_delete_recipes')
      .eq('restaurant_id', membership.restaurantId)
      .then(({ data }) => {
        if (!data) return;
        setMembers(
          data.map((row) => ({
            userId: row.user_id as string,
            cookId: row.cook_id as string | null,
            role: row.role as MemberRole,
            canEditRecipes: Boolean(row.can_edit_recipes),
            canDeleteRecipes: Boolean(row.can_delete_recipes),
          })),
        );
      });
  }

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !membership) return;
    let cancelled = false;
    supabase
      .from('restaurants')
      .select('name, join_code')
      .eq('id', membership.restaurantId)
      .single()
      .then(({ data }) => {
        if (!cancelled && data) setRestaurant({ name: data.name as string, joinCode: data.join_code as string });
      });
    reloadMembers();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membership]);

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
    setRemovedMessage('הוסר!');
    setTimeout(() => setRemovedMessage(''), 1500);
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

  function handleImportFile(file: File) {
    setImportError('');
    file
      .text()
      .then(async (text) => {
        const imported = parseImportedState(text);
        if (isSupabaseConfigured && supabase && membership) {
          const { error } = await supabase.rpc('reset_snapshot', {
            p_restaurant_id: membership.restaurantId,
            p_snapshot: imported,
            p_schema_version: SCHEMA_VERSION,
          });
          if (error) setImportError(error.message);
          return;
        }
        dispatch({ type: 'IMPORT_STATE', state: imported });
      })
      .catch(() => setImportError('הקובץ אינו תקין.'));
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

  async function copyJoinCode() {
    if (!restaurant) return;
    try {
      await navigator.clipboard.writeText(restaurant.joinCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
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
                <button
                  type="button"
                  className="pill"
                  style={{ letterSpacing: 2, border: 'none', cursor: 'pointer' }}
                  onClick={copyJoinCode}
                >
                  {copied ? 'הועתק!' : restaurant.joinCode}
                </button>
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
            {removedMessage && <p style={{ color: 'var(--color-green)' }}>{removedMessage}</p>}
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
          <button type="button" className="btn" style={{ flex: 1 }} onClick={() => fileInputRef.current?.click()}>
            ייבוא גיבוי
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
    </div>
  );
}
