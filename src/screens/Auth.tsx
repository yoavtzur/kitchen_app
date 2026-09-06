import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';

type Mode = 'signin' | 'signup';

export function Auth() {
  const { signUp, signIn } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
        <div className="field" style={{ marginBottom: 0 }}>
          <label>סיסמה</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>
        {error && <p style={{ color: 'var(--color-red)' }}>{error}</p>}
        <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
          {busy ? 'רגע...' : mode === 'signup' ? 'הרשמה' : 'התחברות'}
        </button>
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
      </div>
    </div>
  );
}
