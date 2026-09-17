import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';

/** Step 2 of password recovery: the emailed link already signed this user in, so all that's left
 * is setting a new password. Rendered by AuthGate whenever `recovering` is true. */
export function NewPassword() {
  const { updatePassword, clearRecovering } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError('');
    if (!password || !confirm) {
      setError('נא למלא את שני השדות');
      return;
    }
    if (password.length < 6) {
      setError('הסיסמה חייבת להכיל לפחות 6 תווים');
      return;
    }
    if (password !== confirm) {
      setError('הסיסמאות אינן תואמות');
      return;
    }
    setBusy(true);
    const { error: err } = await updatePassword(password);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    // Session is already valid — dropping the recovery flag lands the user straight in the app.
    clearRecovering();
  }

  return (
    <div>
      <div className="screen-header">
        <h1 className="screen-title">סיסמה חדשה</h1>
      </div>
      <p className="muted" style={{ marginBottom: 'var(--space-3)' }}>
        בחר סיסמה חדשה לחשבון שלך
      </p>
      <div className="card stack-gap-3">
        <div className="field" style={{ marginBottom: 0 }}>
          <label>סיסמה חדשה</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>אישור סיסמה</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>
        {error && <p style={{ color: 'var(--color-red)' }}>{error}</p>}
        <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
          {busy ? 'שומר...' : 'שמירת סיסמה'}
        </button>
        {/* Escape hatch: someone who opened the link by accident shouldn't be stuck here. */}
        <button type="button" className="btn" onClick={clearRecovering}>
          דילוג
        </button>
      </div>
    </div>
  );
}
