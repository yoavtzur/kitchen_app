import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useTimedMessage } from '../lib/useTimedFlag';
import { InstallHintCard } from '../components/InstallHint';

const POLL_MS = 10_000;

/**
 * Shown to a signed-in person whose request to join is waiting on a chef.
 *
 * They are not a member yet, which is exactly why they can see nothing of the kitchen — and also
 * why realtime (which rides on that same row-level security) cannot tell them the good news. So
 * this asks: every ten seconds while the screen is up, and again the moment the app comes back to
 * the foreground, plus a button for the impatient. When the chef approves, the membership is
 * re-read and the gates let them in; when the chef declines, the status flips and `MembershipGate`
 * swaps to the rejection screen on its own.
 */
export function PendingApproval() {
  const { joinStatus, refreshJoinStatus, refreshMembership, dismissJoinRequest, signOut } = useAuth();
  const [checking, setChecking] = useState(false);
  const [note, showNote] = useTimedMessage(3000);

  useEffect(() => {
    let stopped = false;
    async function check() {
      const status = await refreshJoinStatus();
      if (!stopped && status === 'member') refreshMembership();
    }
    const interval = setInterval(check, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      stopped = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [refreshJoinStatus, refreshMembership]);

  async function checkNow() {
    setChecking(true);
    const status = await refreshJoinStatus();
    setChecking(false);
    if (status === 'member') refreshMembership();
    else if (status === null) showNote('אין חיבור כרגע. ננסה שוב בעוד רגע.');
    else if (status === 'pending') showNote('עדיין ממתין לאישור השף');
  }

  const name = [joinStatus?.firstName, joinStatus?.lastName].filter(Boolean).join(' ');

  return (
    <div>
      <div className="screen-header">
        <h1 className="screen-title">ממתין לאישור השף</h1>
      </div>
      <div className="card stack-gap-3" role="status">
        <p>
          {name ? `${name}, הבקשה` : 'הבקשה'} שלך להצטרף
          {joinStatus?.restaurantName ? ` למטבח ${joinStatus.restaurantName}` : ' למטבח'} נשלחה.
        </p>
        <p className="muted">
          ברגע שהשף יאשר אותה תיכנס/י אוטומטית. אפשר להשאיר את המסך פתוח, או לחזור אליו מאוחר יותר.
        </p>
        {note && <p className="muted">{note}</p>}
        <button type="button" className="btn btn-primary btn-block" disabled={checking} onClick={checkNow}>
          {checking ? 'בודק...' : 'בדוק עכשיו'}
        </button>
      </div>
      {/* The natural moment to install: they are waiting anyway, and installing now means the icon
          is the one place they sign in from. */}
      <div style={{ marginTop: 'var(--space-4)' }}>
        <InstallHintCard />
      </div>
      <div className="row" style={{ gap: 8, marginTop: 'var(--space-4)' }}>
        <button type="button" className="btn" style={{ flex: 1 }} onClick={() => void dismissJoinRequest()}>
          ביטול הבקשה
        </button>
        <button type="button" className="btn" style={{ flex: 1 }} onClick={() => signOut()}>
          התנתקות
        </button>
      </div>
    </div>
  );
}
