import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { mapJoinStatus, mapRpcError } from '../lib/rpcErrors';
import { readCachedMembership, writeCachedMembership, type CachedMembership } from './authCache';
import { fullReset } from '../lib/resetLocalData';

type Membership = CachedMembership;

type ActionResult = { error: string | null };

type AuthContextValue = {
  /** Still resolving the initial session on first load. */
  loading: boolean;
  session: Session | null;
  /** Which restaurant (if any) this account belongs to, and as which cook. Falls back to the
   * last-known cached value while a fresh membership fetch is in flight or fails offline. */
  membership: Membership | null;
  membershipLoading: boolean;
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
  createRestaurant(name: string, snapshot: unknown, schemaVersion: number): Promise<ActionResult>;
  joinRestaurant(code: string): Promise<ActionResult>;
  setMyCook(cookId: string): Promise<ActionResult>;
  setMemberPermissions(
    userId: string,
    role: 'chef' | 'cook',
    canEditRecipes: boolean,
    canDeleteRecipes: boolean,
  ): Promise<ActionResult>;
  removeMember(userId: string): Promise<ActionResult>;
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
      .then(({ data, error }) => {
        if (cancelled) return;
        setMembershipLoading(false);
        if (error) return; // offline/transient: keep whatever was cached rather than bounce out
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
        setMembership(next);
        writeCachedMembership(next);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

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

  /** `join_restaurant` reports a refusal in its `status` column instead of raising — see
   * `mapJoinStatus`. So an empty result or any status other than 'ok' is a refusal, and only
   * 'ok' may write a membership: the old code trusted the mere presence of a row, which under
   * the new shape would cache a membership with a null restaurant id. */
  async function joinRestaurant(code: string): Promise<ActionResult> {
    if (!supabase) return { error: 'Supabase אינו מוגדר' };
    const { data, error } = await supabase.rpc('join_restaurant', { p_code: code });
    if (error) return { error: mapRpcError(error) };
    const row = data?.[0];
    if (!row) return { error: 'ההצטרפות נכשלה. נסו שוב.' };
    const refusal = mapJoinStatus(String(row.status));
    if (refusal) return { error: refusal };
    const next: Membership = {
      restaurantId: row.restaurant_id,
      restaurantName: row.name,
      cookId: null,
      role: 'cook',
      canEditRecipes: false,
      canDeleteRecipes: false,
    };
    setMembership(next);
    writeCachedMembership(next);
    return { error: null };
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
        recovering,
        clearRecovering: () => setRecovering(false),
        signUp,
        signIn,
        signOut,
        resetPassword,
        updatePassword,
        createRestaurant,
        joinRestaurant,
        setMyCook,
        setMemberPermissions,
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
