import { useId, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Turnstile } from '../components/Turnstile';

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
  const emailId = useId();
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaNonce, setCaptchaNonce] = useState(0);

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
    const { error: err } = await resetPassword(value, captcha ?? undefined);
    setBusy(false);
    if (err) {
      setError(err);
      // Single-use token, spent even on a rejection — see the same reset in Auth.tsx.
      setCaptcha(null);
      setCaptchaNonce((n) => n + 1);
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
      <form
        className="card stack-gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor={emailId}>אימייל</label>
          <input
            id={emailId}
            name="email"
            type="email"
            // Same `username` as the sign-in form: a manager matches a reset form to the stored
            // credential by this, so a cook gets their address filled instead of typed.
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
        </div>
        {/* Supabase's CAPTCHA setting covers password reset too, not only signup. */}
        <Turnstile onToken={setCaptcha} resetKey={captchaNonce} />
        {error && <p style={{ color: 'var(--color-red)' }}>{error}</p>}
        {sent && (
          <p style={{ color: 'var(--color-ok)' }}>
            אם קיים חשבון עם הכתובת הזו, נשלח אליו קישור לאיפוס סיסמה
          </p>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'שולח...' : 'שליחת קישור לאיפוס'}
        </button>
        <button type="button" className="btn" onClick={onBack}>
          חזרה להתחברות
        </button>
      </form>
    </div>
  );
}
