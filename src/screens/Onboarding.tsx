import { useEffect, useId, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Segmented } from '../components/Segmented';
import { createSeedState, SCHEMA_VERSION } from '../data/seed';
import { validateJoinDetails } from '../lib/cookName';
import { readPendingInvite, writePendingInvite } from '../lib/invite';

type Tab = 'create' | 'join';

export function Onboarding() {
  const { createRestaurant, requestJoin, peekInvite, signOut } = useAuth();
  // An invitation link banks its token before sign-up (see JoinRoute); someone holding one is here
  // to join, not to open a kitchen, so that tab is where they land.
  const [token, setToken] = useState<string | null>(() => readPendingInvite());
  const [tab, setTab] = useState<Tab>(() => (readPendingInvite() ? 'join' : 'create'));
  const [kitchenName, setKitchenName] = useState<string | null>(null);
  const [inviteProblem, setInviteProblem] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const nameId = useId();
  const codeId = useId();
  const firstId = useId();
  const lastId = useId();
  const phoneId = useId();

  // Which kitchen the link is for — and whether it is still any good, found out *before* the
  // person types their details rather than after. A dead link falls back to the code field.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    peekInvite(token).then(({ restaurantName, error: err }) => {
      if (cancelled) return;
      if (err) {
        setInviteProblem(err);
        setToken(null);
        writePendingInvite(null);
      } else {
        setKitchenName(restaurantName);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [token, peekInvite]);

  function selectTab(next: Tab) {
    setTab(next);
    setError('');
  }

  async function create() {
    setError('');
    if (!name.trim()) {
      setError('נא להזין שם למסעדה');
      return;
    }
    setBusy(true);
    const { error: err } = await createRestaurant(name.trim(), createSeedState(), SCHEMA_VERSION);
    setBusy(false);
    if (err) setError(err);
  }

  async function join() {
    setError('');
    const details = validateJoinDetails({ first, last, phone });
    if (!details.ok) {
      setError(details.error);
      return;
    }
    if (!token && code.trim().length < 6) {
      setError('קוד ההצטרפות מורכב מ-6 תווים');
      return;
    }
    setBusy(true);
    // On success nothing happens here: `joinStatus` becomes `pending` and MembershipGate swaps
    // this screen for the waiting one.
    const { error: err } = await requestJoin({
      token: token ?? undefined,
      code: token ? undefined : code.trim(),
      details: details.value,
    });
    setBusy(false);
    if (err) {
      setError(err);
      // A link the server has just refused was cleared by `requestJoin`; show the code field.
      if (token && !readPendingInvite()) setToken(null);
    }
  }

  return (
    <div>
      <div className="screen-header">
        <h1 className="screen-title">בואו נתחיל</h1>
      </div>

      <Segmented
        label="פתיחת מטבח או הצטרפות"
        value={tab}
        onChange={selectTab}
        options={[
          { value: 'create', label: 'פתח מטבח חדש' },
          { value: 'join', label: 'הצטרף למטבח' },
        ]}
      />

      {tab === 'create' ? (
        <form
          className="card stack-gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <p className="muted">ייפתח מרחב עבודה חדש למסעדה שלך, עם נתוני דוגמה שאפשר לערוך מיד.</p>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor={nameId}>שם המסעדה</label>
            <input
              id={nameId}
              name="organization"
              // The one field here a browser can usefully prefill from a saved profile.
              autoComplete="organization"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          {error && <p style={{ color: 'var(--color-red)' }}>{error}</p>}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'רגע...' : 'צור מטבח'}
          </button>
        </form>
      ) : (
        <form
          className="card stack-gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            join();
          }}
        >
          {inviteProblem && <p style={{ color: 'var(--color-red)' }}>{inviteProblem}</p>}
          <p className="muted">
            {token
              ? `הוזמנת להצטרף${kitchenName ? ` למטבח ${kitchenName}` : ' למטבח'}. מלאו את הפרטים, והשף יאשר את הבקשה.`
              : 'הזינו את קוד ההצטרפות שקיבלתם מהשף ואת הפרטים שלכם. השף יאשר את הבקשה.'}
          </p>
          {!token && (
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor={codeId}>קוד הצטרפות</label>
              <input
                id={codeId}
                name="join-code"
                // Explicitly off: a six-character code belongs to a restaurant, not to the person
                // typing it, so a browser offering the last one they used would be wrong every time
                // they join a second kitchen. `one-time-code` would be worse still — it invites the
                // OS to go looking for an SMS that does not exist.
                autoComplete="off"
                // `characters` so a phone keyboard stops capitalizing per word and inserting the
                // corrections that made a code look mistyped.
                autoCapitalize="characters"
                spellCheck={false}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={6}
                style={{ textAlign: 'center', letterSpacing: 4, fontSize: 20, textTransform: 'uppercase' }}
                autoFocus
              />
            </div>
          )}
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor={firstId}>שם פרטי</label>
            <input
              id={firstId}
              name="given-name"
              autoComplete="given-name"
              value={first}
              onChange={(e) => setFirst(e.target.value)}
              maxLength={40}
              autoFocus={Boolean(token)}
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor={lastId}>שם משפחה</label>
            <input
              id={lastId}
              name="family-name"
              autoComplete="family-name"
              value={last}
              onChange={(e) => setLast(e.target.value)}
              maxLength={40}
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor={phoneId}>טלפון (לא חובה)</label>
            <input
              id={phoneId}
              name="tel"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              dir="ltr"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={20}
              style={{ textAlign: 'start' }}
            />
          </div>
          {error && <p style={{ color: 'var(--color-red)' }}>{error}</p>}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'רגע...' : 'שלח בקשה להצטרף'}
          </button>
        </form>
      )}

      <button type="button" className="btn" style={{ marginTop: 'var(--space-4)' }} onClick={() => signOut()}>
        התנתקות
      </button>
    </div>
  );
}
