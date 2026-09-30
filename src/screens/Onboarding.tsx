import { useId, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { createSeedState, SCHEMA_VERSION } from '../data/seed';

type Tab = 'create' | 'join';

export function Onboarding() {
  const { createRestaurant, joinRestaurant, signOut } = useAuth();
  const [tab, setTab] = useState<Tab>('create');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const nameId = useId();
  const codeId = useId();

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
    if (code.trim().length < 6) {
      setError('קוד ההצטרפות מורכב מ-6 תווים');
      return;
    }
    setBusy(true);
    const { error: err } = await joinRestaurant(code.trim());
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <div>
      <div className="screen-header">
        <h1 className="screen-title">בואו נתחיל</h1>
      </div>

      <div className="row" style={{ gap: 8, marginBottom: 'var(--space-4)' }}>
        <button
          type="button"
          className={`btn ${tab === 'create' ? 'btn-primary' : ''}`}
          style={{ flex: 1 }}
          onClick={() => selectTab('create')}
        >
          פתח מטבח חדש
        </button>
        <button
          type="button"
          className={`btn ${tab === 'join' ? 'btn-primary' : ''}`}
          style={{ flex: 1 }}
          onClick={() => selectTab('join')}
        >
          הצטרף למטבח
        </button>
      </div>

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
          <button type="submit" className="btn btn-primary" disabled={busy}>
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
          <p className="muted">הזן את קוד ההצטרפות שקיבלת מהטבח שכבר פתח את המטבח.</p>
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
          {error && <p style={{ color: 'var(--color-red)' }}>{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'רגע...' : 'הצטרף'}
          </button>
        </form>
      )}

      <button type="button" className="btn" style={{ marginTop: 'var(--space-4)' }} onClick={() => signOut()}>
        התנתקות
      </button>
    </div>
  );
}
