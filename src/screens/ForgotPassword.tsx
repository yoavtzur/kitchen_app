import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Step 1 of password recovery: ask Supabase to email a reset link. Reached from Auth.tsx via
 * AuthGate's local view state rather than a route — see the comment in components/Gate.tsx for
 * why auth screens are a render gate and not part of <Routes>. */
export function ForgotPassword({ onBack }: { onBack: () => void }) {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError('');
    setSent(false);
    // Validate locally first so an empty or malformed address never costs a round trip.
    const value = email.trim();
    if (!value) {
      setError('נא להזין כתובת אימייל');
      return;
    }
    if (!EMAIL_RE.test(value)) {
      setError('כתובת אימייל לא תקינה');
      return;
    }
    setBusy(true);
    const { error: err } = await resetPassword(value);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    // Deliberately non-committal wording: the screen must not reveal which addresses have accounts.
    setSent(true);
    setEmail('');
  }

  return (
    <div>
      <div className="screen-header">
        <h1 className="screen-title">איפוס סיסמה</h1>
      </div>
      <p className="muted" style={{ marginBottom: 'var(--space-3)' }}>
        נשלח אליך קישור לאיפוס הסיסמה
      </p>
      <div className="card stack-gap-3">
        <div className="field" style={{ marginBottom: 0 }}>
          <label>אימייל</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>
        {error && <p style={{ color: 'var(--color-red)' }}>{error}</p>}
        {sent && (
          <p style={{ color: 'var(--color-green)' }}>
            אם קיים חשבון עם הכתובת הזו, נשלח אליו קישור לאיפוס סיסמה
          </p>
        )}
        <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
          {busy ? 'שולח...' : 'שליחת קישור לאיפוס'}
        </button>
        <button type="button" className="btn" onClick={onBack}>
          חזרה להתחברות
        </button>
      </div>
    </div>
  );
}
