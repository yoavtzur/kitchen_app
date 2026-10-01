import { useEffect, useId, useState } from 'react';
import { useApp } from '../store/AppContext';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { isSupabaseConfigured } from '../lib/supabase';
import { NAME_MAX, PHONE_MAX, validatePhone } from '../lib/cookName';
import { useTimedMessage } from '../lib/useTimedFlag';
import { ScreenHeader } from '../components/ScreenHeader';
import { BottomSheet } from '../components/BottomSheet';
import { PasswordField } from '../components/PasswordField';
import { EmptyState } from '../components/EmptyState';
import { Toast } from '../components/Toast';
import { initialsOf } from '../lib/initials';

/**
 * "הפרופיל שלי": what the app knows about the person holding the phone, and the only place they
 * can change it — name, phone number, e-mail, password.
 *
 * The name and the number have different homes, which is why they save by different routes. The
 * name is the `Cook` row in the kitchen's data (it is what tasks show), so it is an ordinary op
 * and every device sees the change. The number is personal data and lives behind the
 * `set_my_phone` RPC (migration 0009), visible only to a chef and, for a chef's own number, to
 * their cooks. E-mail and password are the account's and go to Supabase auth directly.
 */
export function Profile() {
  const { state, dispatch } = useApp();
  const { session, membership, getMyPhone, setMyPhone, updateEmail, updatePassword, signOut } = useAuth();
  const { isChef } = usePermissions();

  const cook = membership?.cookId ? state.cooks.find((c) => c.id === membership.cookId) : undefined;
  const email = session?.user.email ?? '';

  const [name, setName] = useState(cook?.name ?? '');
  const [phone, setPhone] = useState('');
  const [savedPhone, setSavedPhone] = useState<string | null>(null);
  const [phoneLoaded, setPhoneLoaded] = useState(false);
  const [phoneLoadFailed, setPhoneLoadFailed] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingEmail, setEditingEmail] = useState(false);
  const [editingPassword, setEditingPassword] = useState(false);
  const [message, showMessage] = useTimedMessage(2000);
  const nameId = useId();
  const phoneId = useId();

  useEffect(() => {
    if (!isSupabaseConfigured || !membership) return;
    let cancelled = false;
    getMyPhone().then(({ phone: stored, error: err }) => {
      if (cancelled) return;
      setPhoneLoaded(true);
      if (err) {
        // Without the stored value the box would look empty, and saving "nothing" would delete a
        // real number. So a failed load locks the field rather than offering it blank.
        setPhoneLoadFailed(true);
        return;
      }
      setSavedPhone(stored);
      setPhone(stored ?? '');
    });
    return () => {
      cancelled = true;
    };
    // `getMyPhone` is recreated every render of the provider; the account is what this tracks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membership?.restaurantId]);

  if (!isSupabaseConfigured || !membership) {
    return (
      <div>
        <ScreenHeader title="הפרופיל שלי" />
        <EmptyState text="במצב מקומי אין חשבון אישי — כל הנתונים שמורים במכשיר הזה." />
      </div>
    );
  }

  const displayName = cook?.name ?? (isChef ? 'שף' : 'טבח');
  const trimmedName = name.trim().replace(/\s+/g, ' ');
  const nameChanged = Boolean(cook) && trimmedName !== cook?.name;
  const phoneChanged = phoneLoaded && !phoneLoadFailed && phone.trim() !== (savedPhone ?? '');

  async function save() {
    setError('');
    if (nameChanged && (!trimmedName || trimmedName.length > NAME_MAX)) {
      setError(!trimmedName ? 'נא להזין שם' : `שם יכול להכיל עד ${NAME_MAX} תווים`);
      return;
    }
    const checked = validatePhone(phone);
    if (phoneChanged && !checked.ok) {
      setError(checked.error);
      return;
    }
    setBusy(true);
    if (phoneChanged && checked.ok) {
      const { error: err } = await setMyPhone(checked.value ?? '');
      if (err) {
        setBusy(false);
        setError(err);
        return;
      }
      setSavedPhone(checked.value ?? null);
      setPhone(checked.value ?? '');
    }
    if (nameChanged && cook) dispatch({ type: 'RENAME_COOK', id: cook.id, name: trimmedName });
    setBusy(false);
    showMessage('נשמר ✓');
  }

  return (
    <div>
      <ScreenHeader title="הפרופיל שלי" />

      <div className="profile-card">
        <span className="avatar" style={cook ? { background: cook.color } : undefined} aria-hidden="true">
          {initialsOf(displayName)}
        </span>
        <div>
          <div className="profile-name">{displayName}</div>
          <div className="profile-sub">
            {isChef ? 'שף' : 'טבח'} · {membership.restaurantName?.trim() || 'ניהול מטבח'}
          </div>
        </div>
      </div>

      <h2 className="section-title">פרטים אישיים</h2>
      <form
        className="card stack-gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {cook && (
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor={nameId}>שם</label>
            <input
              id={nameId}
              value={name}
              maxLength={NAME_MAX}
              autoComplete="name"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        )}
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor={phoneId}>מספר טלפון</label>
          <input
            id={phoneId}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            style={{ textAlign: 'start' }}
            maxLength={PHONE_MAX}
            value={phone}
            disabled={!phoneLoaded || phoneLoadFailed}
            placeholder={phoneLoadFailed ? 'לא ניתן לטעון כרגע' : '050-1234567'}
            onChange={(e) => setPhone(e.target.value)}
          />
          <span className="muted" style={{ fontSize: 13 }}>
            {isChef
              ? 'הטבחים יוכלו להתקשר אליך מהאפליקציה.'
              : 'השף יכול לראות את המספר הזה כדי ליצור איתך קשר. טבחים אחרים לא רואים אותו.'}
          </span>
        </div>
        {error && <p style={{ color: 'var(--color-red)' }}>{error}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy || (!nameChanged && !phoneChanged)}>
          {busy ? 'שומר...' : 'שמירה'}
        </button>
      </form>

      <h2 className="section-title">חשבון</h2>
      <div className="list-card">
        <button type="button" className="menu-row" onClick={() => setEditingEmail(true)}>
          <span className="menu-row-label">
            אימייל
            <span className="muted" dir="ltr" style={{ display: 'block', fontSize: 14, textAlign: 'start' }}>
              {email}
            </span>
          </span>
          <span className="muted">שינוי</span>
        </button>
        <button type="button" className="menu-row" onClick={() => setEditingPassword(true)}>
          <span className="menu-row-label">סיסמה</span>
          <span className="muted">שינוי</span>
        </button>
      </div>

      <div className="list-card">
        <button type="button" className="menu-row danger" onClick={() => signOut()}>
          <span className="menu-row-label">התנתקות</span>
        </button>
      </div>

      {editingEmail && <ChangeEmailSheet current={email} onSubmit={updateEmail} onClose={() => setEditingEmail(false)} />}
      {editingPassword && (
        <ChangePasswordSheet
          onSubmit={updatePassword}
          onDone={() => {
            setEditingPassword(false);
            showMessage('הסיסמה עודכנה ✓');
          }}
          onClose={() => setEditingPassword(false)}
        />
      )}
      {message && <Toast message={message} />}
    </div>
  );
}

function ChangeEmailSheet({
  current,
  onSubmit,
  onClose,
}: {
  current: string;
  onSubmit: (email: string) => Promise<{ error: string | null }>;
  onClose: () => void;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const id = useId();

  async function submit() {
    setError('');
    const next = value.trim();
    if (!next) return setError('נא להזין כתובת אימייל');
    if (next.toLowerCase() === current.toLowerCase()) return setError('זו כבר כתובת האימייל שלך');
    setBusy(true);
    const { error: err } = await onSubmit(next);
    setBusy(false);
    if (err) return setError(err);
    setSentTo(next);
  }

  return (
    <BottomSheet title="שינוי אימייל" onClose={onClose}>
      {sentTo ? (
        <div className="stack-gap-3">
          <p>
            שלחנו הודעת אישור אל <strong dir="ltr">{sentTo}</strong>. הכתובת תתעדכן אחרי שתלחצו על הקישור בהודעה.
          </p>
          <button type="button" className="btn btn-primary btn-block" onClick={onClose}>
            סגור
          </button>
        </div>
      ) : (
        <form
          className="stack-gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor={id}>כתובת אימייל חדשה</label>
            <input
              id={id}
              type="email"
              autoComplete="email"
              dir="ltr"
              style={{ textAlign: 'start' }}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
            />
          </div>
          {error && <p style={{ color: 'var(--color-red)' }}>{error}</p>}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'שולח...' : 'שלח אישור'}
          </button>
        </form>
      )}
    </BottomSheet>
  );
}

function ChangePasswordSheet({
  onSubmit,
  onDone,
  onClose,
}: {
  onSubmit: (password: string) => Promise<{ error: string | null }>;
  onDone: () => void;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError('');
    if (password.length < 6) return setError('הסיסמה חייבת להכיל לפחות 6 תווים');
    if (password !== confirm) return setError('הסיסמאות אינן תואמות');
    setBusy(true);
    const { error: err } = await onSubmit(password);
    setBusy(false);
    if (err) return setError(err);
    onDone();
  }

  return (
    <BottomSheet title="שינוי סיסמה" onClose={onClose}>
      <form
        className="stack-gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <PasswordField
          label="סיסמה חדשה"
          name="new-password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
        <PasswordField
          label="אישור סיסמה"
          name="confirm-password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {error && <p style={{ color: 'var(--color-red)' }}>{error}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'שומר...' : 'שמירת סיסמה'}
        </button>
      </form>
    </BottomSheet>
  );
}
