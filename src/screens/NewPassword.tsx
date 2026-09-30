import { useId, useState } from 'react';
import { useAuth } from '../auth/AuthContext';

/** Step 2 of password recovery: the emailed link already signed this user in, so all that's left
 * is setting a new password. Rendered by AuthGate whenever `recovering` is true. */
export function NewPassword() {
  const { updatePassword, clearRecovering, session } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const passwordId = useId();
  const confirmId = useId();

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
      <form
        className="card stack-gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {/* Not shown and not submitted anywhere — it exists so a password manager can tell which
            stored credential this new password *replaces*, and offer to update it instead of
            saving a second entry for the same account. The recovery link already signed this user
            in, so the address is known here.

            `type="text"` with the `hidden` attribute rather than `type="hidden"`, which Chrome's
            autofill skips when looking for the username on a change-password form — the whole
            point of the field. `readOnly` because nothing should be able to edit it. */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={session?.user.email ?? ''}
          readOnly
          hidden
        />
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor={passwordId}>סיסמה חדשה</label>
          <input
            id={passwordId}
            name="new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor={confirmId}>אישור סיסמה</label>
          <input
            id={confirmId}
            name="confirm-password"
            // Also `new-password`: a manager fills both boxes of a change form with the same
            // generated value, which is exactly what the equality check below wants.
            autoComplete="new-password"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        {error && <p style={{ color: 'var(--color-red)' }}>{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'שומר...' : 'שמירת סיסמה'}
        </button>
        {/* Escape hatch: someone who opened the link by accident shouldn't be stuck here.
            type="button" so it skips rather than submits. */}
        <button type="button" className="btn" onClick={clearRecovering}>
          דילוג
        </button>
      </form>
    </div>
  );
}
