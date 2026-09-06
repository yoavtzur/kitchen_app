import { useState } from 'react';
import { useApp } from '../store/AppContext';
import { useAuth } from '../auth/AuthContext';
import { newId } from '../lib/ids';
import type { Cook } from '../types';

/** Shown once per account, right after joining/creating a restaurant, until the account is bound
 * to a Cook row (`membership.cookId`). Rendered by CookGate, inside AppProvider — it needs
 * `state.cooks` to offer existing cooks, and may dispatch ADD_COOK for a brand-new one. */
export function PickCook() {
  const { state, dispatch } = useApp();
  const { setMyCook, signOut } = useAuth();
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function pick(cookId: string) {
    setError('');
    setBusy(true);
    const { error: err } = await setMyCook(cookId);
    setBusy(false);
    if (err) setError(err);
  }

  async function createAndPick() {
    if (!newName.trim()) return;
    const cook: Cook = {
      id: newId('cook'),
      name: newName.trim(),
      color: `hsl(${Math.floor(Math.random() * 360)}, 45%, 40%)`,
    };
    dispatch({ type: 'ADD_COOK', cook });
    setNewName('');
    await pick(cook.id);
  }

  return (
    <div>
      <div className="screen-header">
        <h1 className="screen-title">מי אני?</h1>
      </div>

      <p className="muted" style={{ marginBottom: 'var(--space-4)' }}>
        בחר את עצמך מרשימת הטבחים, כדי שמשימות ותפקידים ישויכו אליך נכון.
      </p>

      {state.cooks.length > 0 && (
        <div className="card stack-gap-2" style={{ marginBottom: 'var(--space-4)' }}>
          {state.cooks.map((cook) => (
            <button
              key={cook.id}
              type="button"
              className="row-item"
              style={{ width: '100%', textAlign: 'start', border: 'none', background: 'none', cursor: 'pointer' }}
              disabled={busy}
              onClick={() => pick(cook.id)}
            >
              <span className="pill" style={{ background: cook.color + '22', color: cook.color }}>
                {cook.name}
              </span>
              <span className="muted">זה אני ←</span>
            </button>
          ))}
        </div>
      )}

      <h2 className="section-title">לא ברשימה?</h2>
      <div className="card stack-gap-3">
        <div className="field" style={{ marginBottom: 0 }}>
          <label>השם שלך</label>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus={state.cooks.length === 0} />
        </div>
        {error && <p style={{ color: 'var(--color-red)' }}>{error}</p>}
        <button type="button" className="btn btn-primary" onClick={createAndPick} disabled={busy || !newName.trim()}>
          {busy ? 'רגע...' : 'הוסף אותי ובחר'}
        </button>
      </div>

      <button type="button" className="btn" style={{ marginTop: 'var(--space-4)' }} onClick={() => signOut()}>
        התנתקות
      </button>
    </div>
  );
}
