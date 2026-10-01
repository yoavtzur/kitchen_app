import { useState } from 'react';
import { useApp } from '../store/AppContext';
import { useAuth, type JoinRequestRow } from '../auth/AuthContext';
import { useJoinRequests } from '../auth/useJoinRequests';
import { cookNameOf } from '../lib/cookName';
import { newCook } from '../lib/cooks';

/**
 * "יוסי מבקש להצטרף לצוות — [אשר] [דחה]", at the top of the task list for a chef.
 *
 * Shown to a chef and only in synced mode (the hook returns nothing otherwise), and gone entirely
 * while nobody is waiting — it is a prompt, not a permanent panel. Both answers are one tap, as
 * asked: a chef mid-service should not be walked through a form to let a new cook in.
 *
 * Approving does two things in a deliberate order. It first adds the person as a `Cook` in the
 * kitchen's own data — an op like any other, queued and synced even offline — and only then asks
 * the server to turn the request into a membership bound to that cook. That binding is why an
 * approved cook never meets the "who am I" screen. If the server refuses, the cook row is
 * withdrawn again, so a failed approval cannot leave a stray name in the team list.
 */
export function JoinRequestsBanner() {
  const { dispatch } = useApp();
  const { resolveJoinRequest } = useAuth();
  const { requests, reload, drop } = useJoinRequests();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  if (requests.length === 0) return null;

  async function approve(r: JoinRequestRow) {
    setBusyId(r.userId);
    setError('');
    const cook = newCook(cookNameOf(r.firstName, r.lastName));
    dispatch({ type: 'ADD_COOK', cook });
    const { error: err } = await resolveJoinRequest(r.userId, true, cook.id);
    setBusyId(null);
    if (err) {
      dispatch({ type: 'DELETE_COOK', id: cook.id });
      setError(err);
      void reload(); // maybe someone else already answered it
      return;
    }
    drop(r.userId);
  }

  async function reject(r: JoinRequestRow) {
    setBusyId(r.userId);
    setError('');
    const { error: err } = await resolveJoinRequest(r.userId, false);
    setBusyId(null);
    if (err) {
      setError(err);
      void reload();
      return;
    }
    drop(r.userId);
  }

  return (
    <section className="join-requests" aria-label="בקשות הצטרפות">
      {requests.map((r) => (
        <div key={r.userId} className="join-request">
          <div className="join-request-text">
            <span className="dot amber" aria-hidden="true" />
            <div>
              <div>
                <strong>{cookNameOf(r.firstName, r.lastName)}</strong> מבקש/ת להצטרף לצוות
              </div>
              {r.phone && (
                <div className="muted" dir="ltr" style={{ textAlign: 'start', fontSize: 13 }}>
                  {r.phone}
                </div>
              )}
            </div>
          </div>
          <div className="join-request-actions">
            <button type="button" className="btn btn-primary" disabled={busyId === r.userId} onClick={() => approve(r)}>
              אשר
            </button>
            <button type="button" className="btn" disabled={busyId === r.userId} onClick={() => reject(r)}>
              דחה
            </button>
          </div>
        </div>
      ))}
      {error && <p style={{ color: 'var(--color-red)' }}>{error}</p>}
    </section>
  );
}
