import { useAuth } from '../auth/AuthContext';

/** The chef declined the request. The person keeps their account and can ask again with a new
 * link or the code; nothing else is blocked, because the link they used is spent and a fresh one
 * is the chef's to give. */
export function JoinRejected() {
  const { joinStatus, dismissJoinRequest, signOut } = useAuth();
  return (
    <div>
      <div className="screen-header">
        <h1 className="screen-title">הבקשה נדחתה</h1>
      </div>
      <div className="card stack-gap-3" role="status">
        <p>
          השף
          {joinStatus?.restaurantName ? ` של ${joinStatus.restaurantName}` : ''} לא אישר את הבקשה להצטרף.
        </p>
        <p className="muted">אם זו טעות, בקשו מהשף קישור הזמנה חדש והצטרפו שוב.</p>
        <button type="button" className="btn btn-primary btn-block" onClick={() => void dismissJoinRequest()}>
          הבנתי
        </button>
      </div>
      <button type="button" className="btn" style={{ marginTop: 'var(--space-4)' }} onClick={() => signOut()}>
        התנתקות
      </button>
    </div>
  );
}
