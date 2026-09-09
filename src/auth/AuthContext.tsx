import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { readCachedMembership, writeCachedMembership, type CachedMembership } from './authCache';

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
  signUp(email: string, password: string): Promise<ActionResult>;
  signIn(email: string, password: string): Promise<ActionResult>;
  signOut(): Promise<void>;
  createRestaurant(name: string, snapshot: unknown, schemaVersion: number): Promise<ActionResult>;
  joinRestaurant(code: string): Promise<ActionResult>;
  setMyCook(cookId: string): Promise<ActionResult>;
  setMemberPermissions(
    userId: string,
    role: 'chef' | 'cook',
    canEditRecipes: boolean,
    canDeleteRecipes: boolean,
  ): Promise<ActionResult>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function mapAuthError(message: string): string {
  if (message.includes('Invalid login credentials')) return 'אימייל או סיסמה שגויים';
  if (message.includes('User already registered')) return 'כבר קיים חשבון עם האימייל הזה';
  if (message.toLowerCase().includes('password')) return 'הסיסמה חייבת להכיל לפחות 6 תווים';
  if (message.toLowerCase().includes('email')) return 'כתובת אימייל לא תקינה';
  return message;
}

function mapRpcError(err: { code?: string; message: string }): string {
  if (err.code === 'P0002') return 'קוד לא נמצא';
  if (err.code === '23505') return 'החשבון כבר משויך למטבח';
  if (err.code === '42501') {
    return err.message.includes('last_chef') ? 'לא ניתן להוריד את השף האחרון מתפקידו' : 'אין הרשאה לפעולה הזו';
  }
  return err.message;
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
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !session) return;
    let cancelled = false;
    setMembershipLoading(true);
    supabase
      .from('memberships')
      .select('restaurant_id, cook_id, role, can_edit_recipes, can_delete_recipes')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        setMembershipLoading(false);
        if (error) return; // offline/transient: keep whatever was cached rather than bounce out
        const next: Membership | null = data
          ? {
              restaurantId: data.restaurant_id,
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

  async function signUp(email: string, password: string): Promise<ActionResult> {
    if (!supabase) return { error: 'Supabase אינו מוגדר' };
    const { error } = await supabase.auth.signUp({ email, password });
    return { error: error ? mapAuthError(error.message) : null };
  }

  async function signIn(email: string, password: string): Promise<ActionResult> {
    if (!supabase) return { error: 'Supabase אינו מוגדר' };
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? mapAuthError(error.message) : null };
  }

  async function signOut(): Promise<void> {
    if (!supabase) return;
    await supabase.auth.signOut();
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

  async function joinRestaurant(code: string): Promise<ActionResult> {
    if (!supabase) return { error: 'Supabase אינו מוגדר' };
    const { data, error } = await supabase.rpc('join_restaurant', { p_code: code });
    if (error) return { error: mapRpcError(error) };
    const row = data?.[0];
    if (row) {
      const next: Membership = {
        restaurantId: row.restaurant_id,
        cookId: null,
        role: 'cook',
        canEditRecipes: false,
        canDeleteRecipes: false,
      };
      setMembership(next);
      writeCachedMembership(next);
    }
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
        signUp,
        signIn,
        signOut,
        createRestaurant,
        joinRestaurant,
        setMyCook,
        setMemberPermissions,
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
