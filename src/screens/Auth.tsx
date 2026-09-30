import { useId, useState } from 'react';
import { useAuth } from '../auth/AuthContext';

type Mode = 'signin' | 'signup';

export function Auth({ onForgotPassword }: { onForgotPassword: () => void }) {
  const { signUp, signIn } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const emailId = useId();
  const passwordId = useId();

  async function submit() {
    setError('');
    if (!email.trim() || !password) {
      setError('נא למלא אימייל וסיסמה');
      return;
    }
    setBusy(true);
    const { error: err } =
      mode === 'signup' ? await signUp(email.trim(), password) : await signIn(email.trim(), password);
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <div>
      <div className="screen-header">
        <h1 className="screen-title">ניהול מטבח</h1>
      </div>
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
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor={passwordId}>סיסמה</label>
          <input
            id={passwordId}
            name="password"
            type="password"
            // The distinction a manager acts on: `new-password` makes it offer to generate and
            // then save, `current-password` makes it fill the one already stored. Getting this
            // backwards on signup is how a manager ends up saving nothing at all.
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
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
    </div>
  );
}
