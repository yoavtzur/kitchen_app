import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { mapInviteStatus, mapRequestJoinStatus, mapRpcError } from '../lib/rpcErrors';
import { writePendingInvite } from '../lib/invite';
import type { JoinDetails } from '../lib/cookName';
import { readCachedMembership, writeCachedMembership, type CachedMembership } from './authCache';
import { fullReset } from '../lib/resetLocalData';

type Membership = CachedMembership;

type ActionResult = { error: string | null };

/** Where a signed-in person without a membership stands. `none` is the ordinary new account; the
 * other two are a request waiting on a chef, or one a chef turned down. */
export type JoinStatus = {
  status: 'none' | 'pending' | 'rejected';
  restaurantName: string | null;
  firstName: string | null;
  lastName: string | null;
};

/** One person waiting for a chef's answer. */
export type JoinRequestRow = {
  userId: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  createdAt: string;
};

/** One person the caller may contact — see `list_team_contacts` (migration 0009). `phone` and
 * `email` are null when the person has none on file, or when the caller may not see it (only a
 * chef ever receives an e-mail address). */
export type TeamContact = {
  userId: string;
  cookId: string | null;
  role: 'chef' | 'cook';
  phone: string | null;
  email: string | null;
};

type AuthContextValue = {
  /** Still resolving the initial session on first load. */
  loading: boolean;
  session: Session | null;
  /** Which restaurant (if any) this account belongs to, and as which cook. Falls back to the
   * last-known cached value while a fresh membership fetch is in flight or fails offline. */
  membership: Membership | null;
  membershipLoading: boolean;
  /** For an account with no membership: whether it has asked to join somewhere. `null` while
   * unknown (not yet fetched, or the fetch failed offline). */
  joinStatus: JoinStatus | null;
  /** Re-reads the request status. Returns `'member'` when the chef has approved it — the caller
   * (the waiting screen) then calls `refreshMembership`. Never throws; offline yields `null`. */
  refreshJoinStatus(): Promise<JoinStatus['status'] | 'member' | null>;
  refreshMembership(): void;
  /** True once Supabase has reported a PASSWORD_RECOVERY event — i.e. the session came from a
   * reset link, not a normal sign-in, so the user still owes us a new password. */
  recovering: boolean;
  clearRecovering(): void;
  // `captchaToken` is undefined whenever Turnstile is dormant (the default), which is exactly
  // what supabase-js expects when the dashboard's CAPTCHA setting is off. See lib/turnstile.ts
  // for why all three take one rather than only signUp.
  signUp(email: string, password: string, captchaToken?: string): Promise<ActionResult>;
  signIn(email: string, password: string, captchaToken?: string): Promise<ActionResult>;
  signOut(): Promise<void>;
  resetPassword(email: string, captchaToken?: string): Promise<ActionResult>;
  updatePassword(password: string): Promise<ActionResult>;
  /** Asks Supabase to move the account to a new address. It does not take effect until the person
   * confirms from the mail it sends, so `session.user.email` keeps the old address until then. */
  updateEmail(email: string): Promise<ActionResult>;
  /** The caller's own contact number (migration 0009), or null if none is saved. */
  getMyPhone(): Promise<{ phone: string | null; error: string | null }>;
  /** An empty string removes the number. */
  setMyPhone(phone: string): Promise<ActionResult>;
  /** A chef gets every member's number and e-mail; a cook gets the chefs' numbers only. */
  listTeamContacts(): Promise<{ contacts: TeamContact[]; error: string | null }>;
  createRestaurant(name: string, snapshot: unknown, schemaVersion: number): Promise<ActionResult>;
  /** Asks to join a kitchen — by invite token or by the six-character code — and records who is
   * asking. Does NOT make the caller a member: a chef has to approve first. */
  requestJoin(args: { code?: string; token?: string; details: JoinDetails }): Promise<ActionResult>;
  /** Which kitchen a link is for, before committing to it. `error` is set for a link that cannot
   * be used (expired, already used, unknown). */
  peekInvite(token: string): Promise<{ restaurantName: string | null; error: string | null }>;
  /** The requester acknowledging a rejection, or withdrawing a pending request. */
  dismissJoinRequest(): Promise<ActionResult>;
  /** Chef-only. A link good for 72 hours; the token is only ever visible in this return value. */
  createInvite(): Promise<{ token: string | null; error: string | null }>;
  /** Chef-only. People waiting at the door, oldest first. */
  listJoinRequests(): Promise<{ requests: JoinRequestRow[]; error: string | null }>;
  /** Chef-only. Approving makes the person a `cook` bound to `cookId`. */
  resolveJoinRequest(userId: string, approve: boolean, cookId?: string): Promise<ActionResult>;
  setMyCook(cookId: string): Promise<ActionResult>;
  setMemberPermissions(
    userId: string,
    role: 'chef' | 'cook',
    canEditRecipes: boolean,
    canDeleteRecipes: boolean,
  ): Promise<ActionResult>;
  removeMember(userId: string): Promise<ActionResult>;
  /** Owner-only (migration 0011). Hands the restaurant to another chef; the caller stays a chef. */
  transferOwnership(userId: string): Promise<ActionResult>;
  /** Chef-only. Returns the new code on success, so the caller can show it without refetching. */
  rotateJoinCode(): Promise<{ code: string | null; error: string | null }>;
  /** Irreversible. On success the account no longer exists server-side, so this also wipes every
   * local `kitchen-*` key and reloads — there is no session left to sign out of. */
  deleteMyAccount(): Promise<ActionResult>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function mapAuthError(message: string): string {
  if (message.includes('Invalid login credentials')) return 'אימייל או סיסמה שגויים';
  if (message.includes('User already registered')) return 'כבר קיים חשבון עם האימייל הזה';
  if (message.includes('should be different')) return 'הסיסמה החדשה חייבת להיות שונה מהנוכחית';
  if (message.includes('already been registered') || message.includes('already exists'))
    return 'כבר קיים חשבון עם האימייל הזה';
  // Checked before the generic 'email'/'password' substring cases below, which would otherwise
  // mislabel a delivery failure or a throttle as "invalid address".
  if (message.includes('Error sending')) return 'שליחת המייל נכשלה, נסה שוב';
  // Supabase's CAPTCHA setting is on but this build carries no VITE_TURNSTILE_SITE_KEY, so no
  // token is being sent at all — see the ordering note in lib/turnstile.ts. Without this the
  // user reads a raw English "captcha protection: request disallowed" and can do nothing.
  if (message.toLowerCase().includes('captcha')) return 'אימות האבטחה נכשל. רעננו את הדף ונסו שוב.';
  if (message.includes('For security purposes') || message.toLowerCase().includes('rate limit'))
    return 'יותר מדי ניסיונות — נסה שוב בעוד רגע';
  if (message.toLowerCase().includes('password')) return 'הסיסמה חייבת להכיל לפחות 6 תווים';
  if (message.toLowerCase().includes('email')) return 'כתובת אימייל לא תקינה';
  return message;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // In local mode (no Supabase configured) this provider is a harmless no-op: loading resolves
  // immediately, session/membership stay null forever, and every action reports a clear error
  // rather than crashing — AuthGate/MembershipGate never call these when isSupabaseConfigured
  // is false, but the provider itself doesn't need to know that to stay safe.
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [membership, setMembership] = useState<Membership | null>(() => readCachedMembership());
  const [membershipLoading, setMembershipLoading] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [joinStatus, setJoinStatus] = useState<JoinStatus | null>(null);
  // Bumped to re-run the membership fetch on demand (a chef just approved this person).
  const [membershipNonce, setMembershipNonce] = useState(0);

  const refreshJoinStatus = useCallback(async (): Promise<JoinStatus['status'] | 'member' | null> => {
    if (!supabase) return null;
    const { data, error } = await supabase.rpc('my_join_status');
    if (error) return null; // offline or transient: keep what is on screen
    const row = data?.[0];
    if (!row) return null;
    if (row.status === 'member') return 'member';
    const next: JoinStatus = {
      status: row.status === 'pending' || row.status === 'rejected' ? row.status : 'none',
      restaurantName: row.restaurant_name ?? null,
      firstName: row.first_name ?? null,
      lastName: row.last_name ?? null,
    };
    setJoinStatus(next);
    return next.status;
  }, []);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === 'SIGNED_OUT') {
        setMembership(null);
        writeCachedMembership(null);
        setJoinStatus(null);
        setRecovering(false);
      }
      // A reset link signs the user straight in, so `session` alone can't tell a recovery apart
      // from a normal login — this event is the only signal. AuthGate renders NewPassword on it.
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !session) return;
    let cancelled = false;
    setMembershipLoading(true);
    supabase
      .from('memberships')
      .select('restaurant_id, cook_id, role, can_edit_recipes, can_delete_recipes, restaurants(name)')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(async ({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setMembershipLoading(false);
          return; // offline/transient: keep whatever was cached rather than bounce out
        }
        const restaurant = data?.restaurants as { name?: string } | { name?: string }[] | null | undefined;
        const restaurantName = Array.isArray(restaurant) ? restaurant[0]?.name : restaurant?.name;
        const next: Membership | null = data
          ? {
              restaurantId: data.restaurant_id,
              restaurantName,
              cookId: data.cook_id,
              role: data.role as Membership['role'],
              canEditRecipes: Boolean(data.can_edit_recipes),
              canDeleteRecipes: Boolean(data.can_delete_recipes),
            }
          : null;
        // No membership: find out whether this account is waiting on a chef *before* reporting the
        // fetch as finished, so a returning pending cook is never shown the onboarding form for a
        // moment on the way to the waiting screen.
        if (!next) await refreshJoinStatus();
        if (cancelled) return;
        setMembershipLoading(false);
        // Re-fetched on every focus now (below), so an unchanged answer must not hand the whole
        // app a new object to re-render from.
        setMembership((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
        writeCachedMembership(next);
        // A member has no use for the invitation they arrived with.
        if (next) writePendingInvite(null);
      });
    return () => {
      cancelled = true;
    };
  }, [session, membershipNonce, refreshJoinStatus]);

  // A role is changed on someone else's phone (a chef makes a cook a chef, or the reverse), and the
  // cached membership is authoritative until re-fetched — so without this, the person promoted kept
  // the cook's app until they signed out and in. Re-check whenever the app comes back to the
  // foreground (throttled) and every few minutes while it stays open. Offline, the fetch fails and
  // the cache is kept, exactly as on launch.
  const hasMembership = Boolean(membership);
  useEffect(() => {
    if (!supabase || !session || !hasMembership) return;
    let last = Date.now();
    const bump = () => {
      if (Date.now() - last < 30_000) return;
      last = Date.now();
      setMembershipNonce((n) => n + 1);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') bump();
    };
    window.addEventListener('focus', bump);
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(() => setMembershipNonce((n) => n + 1), 3 * 60_000);
    return () => {
      window.removeEventListener('focus', bump);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [session, hasMembership]);

  async function signUp(email: string, password: string, captchaToken?: string): Promise<ActionResult> {
    if (!supabase) return { error: 'Supabase אינו מוגדר' };
    const { error } = await supabase.auth.signUp({ email, password, options: { captchaToken } });
    return { error: error ? mapAuthError(error.message) : null };
  }

  async function signIn(email: string, password: string, captchaToken?: string): Promise<ActionResult> {
    if (!supabase) return { error: 'Supabase אינו מוגדר' };
    const { error } = await supabase.auth.signInWithPassword({ email, password, options: { captchaToken } });
    return { error: error ? mapAuthError(error.message) : null };
  }

  async function signOut(): Promise<void> {
    if (!supabase) return;
    await supabase.auth.signOut();
  }

  async function resetPassword(email: string, captchaToken?: string): Promise<ActionResult> {
    if (!supabase) return { error: 'Supabase אינו מוגדר' };
    // Supabase emails a link back to `redirectTo` with its own `#access_token=...&type=recovery`
    // fragment appended. This app uses HashRouter, so redirectTo deliberately carries no `#/...`
    // route of its own: supabase-js's detectSessionInUrl (on by default) consumes that fragment
    // and clears it, leaving an empty hash that HashRouter resolves to "/".
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname,
      captchaToken,
    });
    return { error: error ? mapAuthError(error.message) : null };
  }

  async function updatePassword(password: string): Promise<ActionResult> {
    if (!supabase) return { error: 'Supabase אינו מוגדר' };
    // Acts on whatever session is current — for a recovery that's the one the emailed link
    // established, which is exactly what makes a reset possible without the old password.
    const { error } = await supabase.auth.updateUser({ password });
    return { error: error ? mapAuthError(error.message) : null };
  }

  async function updateEmail(email: string): Promise<ActionResult> {
    if (!supabase) return { error: 'Supabase אינו מוגדר' };
    const { error } = await supabase.auth.updateUser({ email });
    return { error: error ? mapAuthError(error.message) : null };
  }

  async function getMyPhone(): Promise<{ phone: string | null; error: string | null }> {
    if (!supabase) return { phone: null, error: 'Supabase אינו מוגדר' };
    const { data, error } = await supabase.rpc('get_my_phone');
    if (error) return { phone: null, error: mapRpcError(error) };
    return { phone: typeof data === 'string' && data ? data : null, error: null };
  }

  async function setMyPhone(phone: string): Promise<ActionResult> {
    if (!supabase) return { error: 'Supabase אינו מוגדר' };
    const { error } = await supabase.rpc('set_my_phone', { p_phone: phone });
    return { error: error ? mapRpcError(error) : null };
  }

  async function listTeamContacts(): Promise<{ contacts: TeamContact[]; error: string | null }> {
    if (!supabase) return { contacts: [], error: 'Supabase אינו מוגדר' };
    const { data, error } = await supabase.rpc('list_team_contacts');
    if (error) return { contacts: [], error: mapRpcError(error) };
    return {
      contacts: ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        userId: r.user_id as string,
        cookId: (r.cook_id as string | null) ?? null,
        role: r.role === 'chef' ? 'chef' : 'cook',
        phone: (r.phone as string | null) ?? null,
        email: (r.email as string | null) ?? null,
      })),
      error: null,
    };
  }

  async function createRestaurant(name: string, snapshot: unknown, schemaVersion: number): Promise<ActionResult> {
    if (!supabase) return { error: 'Supabase אינו מוגדר' };
    const { data, error } = await supabase.rpc('create_restaurant', {
      p_name: name,
      p_snapshot: snapshot,
      p_schema_version: schemaVersion,
    });
    if (error) return { error: mapRpcError(error) };
    const row = data?.[0];
    if (row) {
      const next: Membership = {
        restaurantId: row.restaurant_id,
        restaurantName: name,
        cookId: null,
        role: 'chef',
        canEditRecipes: false,
        canDeleteRecipes: false,
      };
      setMembership(next);
      writeCachedMembership(next);
    }
    return { error: null };
  }

  /** `request_join` reports a refusal in its `status` column instead of raising — see
   * `mapRequestJoinStatus`. A success records a *request*, never a membership: the caller waits
   * for a chef, and `MembershipGate` swaps to the waiting screen on `joinStatus`. */
  async function requestJoin({
    code,
    token,
    details,
  }: {
    code?: string;
    token?: string;
    details: JoinDetails;
  }): Promise<ActionResult> {
    if (!supabase) return { error: 'Supabase אינו מוגדר' };
    const { data, error } = await supabase.rpc('request_join', {
      p_code: code ?? null,
      p_token: token ?? null,
      p_first: details.first,
      p_last: details.last,
      p_phone: details.phone ?? null,
    });
    if (error) return { error: mapRpcError(error) };
    const row = data?.[0];
    if (!row) return { error: 'ההצטרפות נכשלה. נסו שוב.' };
    const refusal = mapRequestJoinStatus(row.status);
    if (refusal) {
      // A link the server will not take again is no use to keep: drop it so the form falls back
      // to the code field instead of failing the same way on every attempt.
      if (row.status === 'invalid_invite') writePendingInvite(null);
      return { error: refusal };
    }
    writePendingInvite(null);
    setJoinStatus({
      status: 'pending',
      restaurantName: row.restaurant_name ?? null,
      firstName: details.first,
      lastName: details.last,
    });
    return { error: null };
  }

  async function peekInvite(token: string): Promise<{ restaurantName: string | null; error: string | null }> {
    if (!supabase) return { restaurantName: null, error: 'Supabase אינו מוגדר' };
    const { data, error } = await supabase.rpc('peek_invite', { p_token: token });
    if (error) return { restaurantName: null, error: mapRpcError(error) };
    const row = data?.[0];
    const refusal = mapInviteStatus(row?.status);
    return { restaurantName: row?.restaurant_name ?? null, error: refusal };
  }

  async function dismissJoinRequest(): Promise<ActionResult> {
    if (!supabase) return { error: 'Supabase אינו מוגדר' };
    const { error } = await supabase.rpc('dismiss_join_rejection');
    if (error) return { error: mapRpcError(error) };
    setJoinStatus({ status: 'none', restaurantName: null, firstName: null, lastName: null });
    return { error: null };
  }

  async function createInvite(): Promise<{ token: string | null; error: string | null }> {
    if (!supabase) return { token: null, error: 'Supabase אינו מוגדר' };
    const { data, error } = await supabase.rpc('create_invite');
    if (error) return { token: null, error: mapRpcError(error) };
    return typeof data === 'string' && data
      ? { token: data, error: null }
      : { token: null, error: 'יצירת הקישור נכשלה. נסו שוב.' };
  }

  async function listJoinRequests(): Promise<{ requests: JoinRequestRow[]; error: string | null }> {
    if (!supabase) return { requests: [], error: 'Supabase אינו מוגדר' };
    const { data, error } = await supabase.rpc('list_join_requests');
    if (error) return { requests: [], error: mapRpcError(error) };
    return {
      requests: ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        userId: r.user_id as string,
        firstName: r.first_name as string,
        lastName: r.last_name as string,
        phone: (r.phone as string | null) ?? null,
        createdAt: r.created_at as string,
      })),
      error: null,
    };
  }

  async function resolveJoinRequest(userId: string, approve: boolean, cookId?: string): Promise<ActionResult> {
    if (!supabase) return { error: 'Supabase אינו מוגדר' };
    const { error } = await supabase.rpc('resolve_join_request', {
      p_user_id: userId,
      p_approve: approve,
      p_cook_id: cookId ?? null,
    });
    if (error) return { error: mapRpcError(error) };
    return { error: null };
  }

  async function transferOwnership(userId: string): Promise<ActionResult> {
    if (!supabase) return { error: 'Supabase אינו מוגדר' };
    const { error } = await supabase.rpc('transfer_ownership', { p_user_id: userId });
    return { error: error ? mapRpcError(error) : null };
  }

  async function setMemberPermissions(
    userId: string,
    role: 'chef' | 'cook',
    canEditRecipes: boolean,
    canDeleteRecipes: boolean,
  ): Promise<ActionResult> {
    if (!supabase) return { error: 'Supabase אינו מוגדר' };
    const { error } = await supabase.rpc('set_member_permissions', {
      p_user_id: userId,
      p_role: role,
      p_can_edit_recipes: canEditRecipes,
      p_can_delete_recipes: canDeleteRecipes,
    });
    if (error) return { error: mapRpcError(error) };
    // If the chef edited their own row, reflect it locally right away rather than waiting on
    // the membership refetch effect (which only fires on a session change).
    if (membership && userId === session?.user.id) {
      const next: Membership = { ...membership, role, canEditRecipes, canDeleteRecipes };
      setMembership(next);
      writeCachedMembership(next);
    }
    return { error: null };
  }

  async function removeMember(userId: string): Promise<ActionResult> {
    if (!supabase) return { error: 'Supabase אינו מוגדר' };
    const { error } = await supabase.rpc('remove_member', { p_user_id: userId });
    if (error) return { error: mapRpcError(error) };
    return { error: null };
  }

  async function rotateJoinCode(): Promise<{ code: string | null; error: string | null }> {
    if (!supabase) return { code: null, error: 'Supabase אינו מוגדר' };
    const { data, error } = await supabase.rpc('rotate_join_code');
    if (error) return { code: null, error: mapRpcError(error) };
    return { code: typeof data === 'string' ? data : null, error: null };
  }

  /**
   * The account is gone server-side the moment this returns, so there is no "signed in but
   * deleted" state to render: everything local goes with it and the page reloads into a clean
   * sign-in screen. `fullReset` is the same tier-3 wipe the crash screen offers, reused here
   * because the list of `kitchen-*` keys belongs in exactly one place.
   */
  async function deleteMyAccount(): Promise<ActionResult> {
    if (!supabase) return { error: 'Supabase אינו מוגדר' };
    const { error } = await supabase.rpc('delete_my_account');
    if (error) return { error: mapRpcError(error) };
    // fullReset ends in softReset(), which reloads — so nothing after this line runs, and
    // nothing needs to: there is no session to update state from.
    await fullReset(signOut);
    return { error: null };
  }

  async function setMyCook(cookId: string): Promise<ActionResult> {
    if (!supabase || !membership) return { error: 'לא ניתן כרגע' };
    const { error } = await supabase.rpc('set_my_cook', {
      p_restaurant_id: membership.restaurantId,
      p_cook_id: cookId,
    });
    if (error) return { error: mapRpcError(error) };
    const next: Membership = { ...membership, cookId };
    setMembership(next);
    writeCachedMembership(next);
    return { error: null };
  }

  return (
    <AuthContext.Provider
      value={{
        loading,
        session,
        membership,
        membershipLoading,
        joinStatus,
        refreshJoinStatus,
        refreshMembership: () => setMembershipNonce((n) => n + 1),
        recovering,
        clearRecovering: () => setRecovering(false),
        signUp,
        signIn,
        signOut,
        resetPassword,
        updatePassword,
        updateEmail,
        getMyPhone,
        setMyPhone,
        listTeamContacts,
        createRestaurant,
        requestJoin,
        peekInvite,
        dismissJoinRequest,
        createInvite,
        listJoinRequests,
        resolveJoinRequest,
        setMyCook,
        setMemberPermissions,
        transferOwnership,
        removeMember,
        rotateJoinCode,
        deleteMyAccount,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
