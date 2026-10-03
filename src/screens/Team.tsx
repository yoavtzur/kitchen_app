import { useEffect, useState } from 'react';
import { useApp } from '../store/AppContext';
import { useAuth, type TeamContact } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { useTeamMembers, type MemberRow } from '../auth/useTeamMembers';
import { isSupabaseConfigured } from '../lib/supabase';
import { newCook } from '../lib/cooks';
import { buildInviteLink } from '../lib/invite';
import { useTimedMessage } from '../lib/useTimedFlag';
import { rowControls } from '../lib/teamRoles';
import { useUndo } from '../lib/undo';
import type { Cook } from '../types';
import { ScreenHeader } from '../components/ScreenHeader';
import { CookPill } from '../components/CookPill';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ContactActions } from '../components/ContactActions';
import { InviteCookSheet } from '../components/InviteCookSheet';
import { JoinRequestsBanner } from '../components/JoinRequestsBanner';
import { Toast } from '../components/Toast';

/**
 * The team, in one place.
 *
 * Settings used to show the same people twice — "הרשאות צוות" (accounts, with their permissions)
 * and "טבחים" (the `Cook` rows tasks are assigned to) — because those are two different tables
 * underneath. They are one list to the person looking at it, so this renders one: every account
 * with its cook, then any cook that has no account behind it.
 *
 * What a person sees depends on who they are:
 *   chef  everyone — role, phone, e-mail, permissions, remove; plus invite and approve.
 *         Making, unmaking and removing a *chef* is the owner's (migration 0011, lib/teamRoles.ts).
 *   cook  the kitchen's people, and how to reach the chef (call / WhatsApp)
 *   local mode (no accounts at all): just the cooks, which is all there is to manage
 */
export function Team() {
  const { state, dispatch } = useApp();
  const { session, membership, setMemberPermissions, removeMember, transferOwnership, createInvite, listTeamContacts } =
    useAuth();
  const { isChef } = usePermissions();
  const { deleteWithUndo } = useUndo();
  const { members, ownerId, loading, error: membersError, reload, retry } = useTeamMembers();
  // A role change waits for a confirmation: a chef can export everything, remove people and
  // approve newcomers, so the switch is not something a stray tap should flip.
  const [roleCandidate, setRoleCandidate] = useState<{ row: MemberRow; role: 'chef' | 'cook' } | null>(null);
  const [transferCandidate, setTransferCandidate] = useState<MemberRow | null>(null);

  const [contacts, setContacts] = useState<Map<string, TeamContact>>(new Map());
  const [contactsFailed, setContactsFailed] = useState(false);
  const [newCookName, setNewCookName] = useState('');
  const [permError, setPermError] = useState('');
  const [removeCandidate, setRemoveCandidate] = useState<MemberRow | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [message, showMessage] = useTimedMessage(1500);

  const myUserId = session?.user.id;

  useEffect(() => {
    if (!isSupabaseConfigured || !membership) return;
    let cancelled = false;
    listTeamContacts().then(({ contacts: rows, error }) => {
      if (cancelled) return;
      // Contacts are an extra: a failure (or a server that has not got migration 0009 yet) must
      // not hide the team itself, so it only drops the phone line and says so once.
      setContactsFailed(Boolean(error));
      setContacts(new Map(rows.map((c) => [c.userId, c])));
    });
    return () => {
      cancelled = true;
    };
    // `members` is a dependency on purpose: an approval or removal changes who has a contact row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membership, members]);

  const boundCookIds = new Set(members.map((m) => m.cookId).filter((id): id is string => !!id));
  // Until the member list has loaded, every cook looks like it has no account — and "no account"
  // is what unlocks a one-tap delete. Hold the section back rather than offer that on a guess.
  const membersKnown = !isSupabaseConfigured || (!loading && !membersError);
  const accountless = membersKnown ? state.cooks.filter((c) => !boundCookIds.has(c.id)) : [];

  async function confirmRoleChange() {
    if (!roleCandidate) return;
    const { row, role } = roleCandidate;
    setRoleCandidate(null);
    await updatePermissions(row, { role });
    showMessage(role === 'chef' ? 'מונה לשף ✓' : 'הוחזר לטבח ✓');
  }

  async function confirmTransfer() {
    if (!transferCandidate) return;
    setPermError('');
    const { error } = await transferOwnership(transferCandidate.userId);
    setTransferCandidate(null);
    if (error) {
      setPermError(error);
      return;
    }
    reload();
    showMessage('הבעלות הועברה ✓');
  }

  async function updatePermissions(
    row: MemberRow,
    patch: Partial<Pick<MemberRow, 'role' | 'canEditRecipes' | 'canDeleteRecipes'>>,
  ) {
    setPermError('');
    const next = { ...row, ...patch };
    const { error } = await setMemberPermissions(row.userId, next.role, next.canEditRecipes, next.canDeleteRecipes);
    if (error) {
      setPermError(error);
      return;
    }
    reload();
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
    reload();
    setRemoveCandidate(null);
    showMessage('הוסר!');
  }

  function addCook() {
    const name = newCookName.trim();
    if (!name) return;
    dispatch({ type: 'ADD_COOK', cook: newCook(name) });
    setNewCookName('');
  }

  /** Two taps for the chef: this, then "שתף בוואטסאפ" in the sheet. */
  async function doInvite() {
    setInviteError('');
    setInviting(true);
    const { token, error } = await createInvite();
    setInviting(false);
    if (error || !token) {
      setInviteError(error ?? 'יצירת הקישור נכשלה. נסו שוב.');
      return;
    }
    setInviteLink(buildInviteLink(window.location.origin, window.location.pathname, token));
  }

  /** Cooks that do have an account get the "remove from kitchen" flow instead; this is only for
   * the ones that don't, where deleting the row is the whole story — and a mis-tap is one "בטל" away. */
  function deleteAccountlessCook(cook: Cook) {
    deleteWithUndo({ type: 'DELETE_COOK', id: cook.id }, `"${cook.name}" נמחק`);
  }

  const cookOf = (id: string | null) => (id ? state.cooks.find((c) => c.id === id) : undefined);
  // Chefs first, then by name — the order a cook scanning for "who do I call" expects.
  const sortedMembers = [...members].sort((a, b) => {
    if (a.role !== b.role) return a.role === 'chef' ? -1 : 1;
    return (cookOf(a.cookId)?.name ?? '').localeCompare(cookOf(b.cookId)?.name ?? '', 'he');
  });

  return (
    <div>
      <ScreenHeader title="צוות" />

      {isSupabaseConfigured && isChef && (
        <>
          <div className="card stack-gap-3">
            <button type="button" className="btn btn-primary btn-block" disabled={inviting} onClick={doInvite}>
              {inviting ? 'יוצר קישור...' : 'הזמן טבח'}
            </button>
            {inviteError && <p style={{ color: 'var(--color-red)' }}>{inviteError}</p>}
          </div>
          <JoinRequestsBanner onApproved={reload} />
        </>
      )}

      {isSupabaseConfigured && (
        <>
          <h2 className="section-title">חברי צוות</h2>
          <div className="card">
            {permError && <p style={{ color: 'var(--color-red)' }}>{permError}</p>}
            {loading && members.length === 0 && <p className="muted">טוען צוות...</p>}
            {membersError && (
              <div className="stack-gap-2">
                <p style={{ color: 'var(--color-red)' }}>טעינת הצוות נכשלה: {membersError}</p>
                <button type="button" className="btn" onClick={retry}>
                  נסה שוב
                </button>
              </div>
            )}
            {isChef && contactsFailed && (
              <p className="muted" style={{ marginBottom: 'var(--space-2)' }}>
                פרטי הקשר לא נטענו כרגע.
              </p>
            )}
            {sortedMembers.map((row) => {
              const cook = cookOf(row.cookId);
              const contact = contacts.get(row.userId);
              const isMe = row.userId === myUserId;
              const can = rowControls(row, myUserId, isChef, ownerId, members);
              const nameOf = cook?.name ?? 'חבר צוות';
              return (
                <div key={row.userId} className="team-row">
                  <div className="team-row-head">
                    <div className="row" style={{ gap: 8, width: 'auto' }}>
                      {cook ? <CookPill cook={cook} /> : <span className="muted">טבח לא משויך</span>}
                      {row.role === 'chef' && <span className="pill">שף</span>}
                      {can.isOwner && <span className="pill green">בעלים</span>}
                      {isMe && <span className="muted">(אני)</span>}
                    </div>
                    {can.canRemove && (
                      <button
                        type="button"
                        className="btn btn-icon"
                        aria-label="הסר טבח"
                        onClick={() => setRemoveCandidate(row)}
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {/* The phone line: a cook sees it only on a chef (the server sends nothing else),
                      so "no number" here is worth saying only about someone the viewer may call. */}
                  {contact?.phone ? (
                    <ContactActions phone={contact.phone} />
                  ) : (
                    (isChef || row.role === 'chef') &&
                    !isMe &&
                    !contactsFailed && <span className="muted">לא הוזן מספר טלפון</span>
                  )}
                  {isChef && contact?.email && (
                    <a className="contact-email" href={`mailto:${contact.email}`} dir="ltr" style={{ textAlign: 'start' }}>
                      {contact.email}
                    </a>
                  )}

                  {(can.canMakeChef || can.canUnmakeChef) && (
                    <label className="row team-chef-toggle" style={{ gap: 6, width: 'auto', justifyContent: 'flex-start' }}>
                      <input
                        type="checkbox"
                        checked={row.role === 'chef'}
                        onChange={(e) => setRoleCandidate({ row, role: e.target.checked ? 'chef' : 'cook' })}
                        style={{ width: 'auto' }}
                      />
                      {isMe ? 'אני שף (ביטול יחזיר אותי לטבח)' : 'שף — גישה מלאה כמו שלך'}
                    </label>
                  )}
                  {can.canTransferOwnership && (
                    <button type="button" className="btn btn-sm" onClick={() => setTransferCandidate(row)}>
                      העבר בעלות ל{nameOf}
                    </button>
                  )}

                  {can.canEditPermissions &&
                    (cook ? (
                      <div className="row" style={{ gap: 12, width: 'auto', justifyContent: 'flex-start', flexWrap: 'wrap' }}>
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
                      </div>
                    ) : (
                      <span className="muted">צריך להתחבר לפני שאפשר להגדיר הרשאות</span>
                    ))}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Cooks with no account: added by hand so tasks can be assigned to them, or — in local
          mode, where there are no accounts at all — simply the whole team. */}
      {isChef && (accountless.length > 0 || !isSupabaseConfigured) && (
        <>
          <h2 className="section-title">{isSupabaseConfigured ? 'טבחים ללא חשבון' : 'טבחים'}</h2>
          <div className="card">
            {accountless.map((cook) => (
              <div key={cook.id} className="team-row">
                <div className="team-row-head">
                  <CookPill cook={cook} />
                  <button
                    type="button"
                    className="btn btn-icon"
                    aria-label={`מחק את ${cook.name}`}
                    onClick={() => deleteAccountlessCook(cook)}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {isChef && (
        <>
          <h2 className="section-title">{isSupabaseConfigured ? 'הוספת טבח ללא חשבון' : 'הוספת טבח'}</h2>
          <div className="card">
            <form
              className="row"
              style={{ gap: 8 }}
              onSubmit={(e) => {
                e.preventDefault();
                addCook();
              }}
            >
              <input
                value={newCookName}
                onChange={(e) => setNewCookName(e.target.value)}
                placeholder="שם טבח חדש"
                aria-label="שם טבח חדש"
                style={{ flex: 1, border: '1px solid var(--color-border)', borderRadius: 8, padding: '8px' }}
              />
              <button type="submit" className="btn btn-primary">
                הוסף
              </button>
            </form>
          </div>
        </>
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
            האם אתה בטוח שברצונך להסיר את {cookOf(removeCandidate.cookId)?.name ?? 'טבח לא משויך'}? הפעולה תמחק את
            הגישה שלו למסעדה לצמיתות, אך היסטוריית המשימות שבוצעו תישמר.
          </p>
        </ConfirmDialog>
      )}

      {roleCandidate && (
        <ConfirmDialog
          title={roleCandidate.role === 'chef' ? 'מינוי לשף' : 'החזרה לטבח'}
          confirmLabel={roleCandidate.role === 'chef' ? 'מנה לשף' : 'החזר לטבח'}
          destructive={roleCandidate.role === 'cook'}
          onClose={() => setRoleCandidate(null)}
          onConfirm={confirmRoleChange}
        >
          {roleCandidate.role === 'chef' ? (
            <p>
              {cookOf(roleCandidate.row.cookId)?.name ?? 'חבר הצוות'} יראה את האפליקציה בדיוק כמו שף: הזמנות, צריכה,
              עמדות, צוות, אישור מצטרפים, הסרת טבחים וייצוא כל הנתונים.
            </p>
          ) : roleCandidate.row.userId === myUserId ? (
            <p>תחזור/י לתצוגה של טבח ותאבד/י את אפשרויות השף. רק בעלי המסעדה יוכלו למנות אותך שוב.</p>
          ) : (
            <p>{cookOf(roleCandidate.row.cookId)?.name ?? 'חבר הצוות'} יחזור לתצוגה של טבח ויאבד את אפשרויות השף.</p>
          )}
        </ConfirmDialog>
      )}

      {transferCandidate && (
        <ConfirmDialog
          title="העברת בעלות"
          confirmLabel="העבר בעלות"
          destructive
          onClose={() => setTransferCandidate(null)}
          onConfirm={confirmTransfer}
        >
          <p>
            {cookOf(transferCandidate.cookId)?.name ?? 'השף'} יהיה הבעלים של המסעדה: רק הוא יוכל למנות, להוריד ולהסיר
            שפים — גם אותך. את/ה תישאר/י שף.
          </p>
        </ConfirmDialog>
      )}

      {inviteLink && (
        <InviteCookSheet link={inviteLink} restaurantName={membership?.restaurantName} onClose={() => setInviteLink(null)} />
      )}

      {message && <Toast message={message} />}
    </div>
  );
}
