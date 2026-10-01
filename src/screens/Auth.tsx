import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { PasswordField } from '../components/PasswordField';
import { Turnstile } from '../components/Turnstile';
import { readPendingInvite } from '../lib/invite';

type Mode = 'signin' | 'signup';

export function Auth({ onForgotPassword }: { onForgotPassword: () => void }) {
  const { signUp, signIn } = useAuth();
  // Opened from an invitation link (see JoinRoute): this person has no account yet, so start on
  // sign-up and say why they are here. A returning cook can still flip to sign-in.
  const [invited] = useState(() => readPendingInvite() !== null);
  const [mode, setMode] = useState<Mode>(invited ? 'signup' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const emailId = useId();
  const passwordId = useId();
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaNonce, setCaptchaNonce] = useState(0);

  async function submit() {
    setError('');
    if (!email.trim() || !password) {
      setError('נא למלא אימייל וסיסמה');
      return;
    }
    setBusy(true);
    const token = captcha ?? undefined;
    const { error: err } =
      mode === 'signup'
        ? await signUp(email.trim(), password, token)
        : await signIn(email.trim(), password, token);
    setBusy(false);
    if (err) {
      setError(err);
      // A Turnstile token is single use and is spent even on a rejected attempt, so without this
      // the second try fails on the captcha rather than on the password, and every message after
      // the first is the wrong one. No-op while Turnstile is dormant.
      setCaptcha(null);
      setCaptchaNonce((n) => n + 1);
    }
  }

  return (
    <div>
      <div className="screen-header">
        <h1 className="screen-title">ניהול מטבח</h1>
      </div>
      {invited && (
        <p className="card" style={{ marginBottom: 'var(--space-3)' }}>
          הוזמנת להצטרף למטבח. {mode === 'signup' ? 'צרו חשבון' : 'התחברו'} כדי להמשיך — אחר כך תמלאו שם, והשף יאשר את
          הבקשה.
        </p>
      )}
      <p className="muted" style={{ marginBottom: 'var(--space-3)' }}>
        {mode === 'signup' ? 'צור חשבון כדי להתחיל' : 'התחבר לחשבון שלך'}
      </p>
      {/* A real <form> with a real submit button, not a div full of inputs and a click handler.
          That is what a password manager looks for before it offers to fill or to save a
          credential — and it also gives Enter-to-submit for free, which this screen previously
          hand-rolled with an onKeyDown on each input. */}
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
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
        </div>
        <PasswordField
          id={passwordId}
          label="סיסמה"
          name="password"
          // The distinction a manager acts on: `new-password` makes it offer to generate and
          // then save, `current-password` makes it fill the one already stored. Getting this
          // backwards on signup is how a manager ends up saving nothing at all.
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {/* Renders nothing unless VITE_TURNSTILE_SITE_KEY is set. Deliberately does NOT gate the
            submit button: a challenge that fails to load must not lock the kitchen out of its
            own app — see lib/turnstile.ts. */}
        <Turnstile onToken={setCaptcha} resetKey={captchaNonce} />
        {error && <p style={{ color: 'var(--color-red)' }}>{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'רגע...' : mode === 'signup' ? 'הרשמה' : 'התחברות'}
        </button>
        {/* Both stay type="button": inside a form, a bare <button> submits, so either one would
            try to sign in on its way to doing something else entirely. */}
        {mode === 'signin' && (
          <button type="button" className="btn" onClick={onForgotPassword}>
            שכחתי סיסמה
          </button>
        )}
        <button
          type="button"
          className="btn"
          onClick={() => {
            setMode(mode === 'signup' ? 'signin' : 'signup');
            setError('');
          }}
        >
          {mode === 'signup' ? 'יש לי כבר חשבון — התחברות' : 'משתמש חדש? הרשמה'}
        </button>
      </form>
      {/* The only screen a person sees before an account exists, so it is the only place these
          links can be given *before* the processing they describe begins. Both routes render
          outside every gate — see LEGAL_ROUTES. */}
      <p className="muted" style={{ marginTop: 'var(--space-3)', textAlign: 'center' }}>
        בהרשמה ובשימוש באפליקציה אתם מאשרים את <Link to="/legal/terms">תנאי השימוש</Link> ואת{' '}
        <Link to="/legal/privacy">מדיניות הפרטיות</Link>.
      </p>
    </div>
  );
}
