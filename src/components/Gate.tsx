import type { ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { isSupabaseConfigured } from '../lib/supabase';
import { Auth } from '../screens/Auth';
import { Onboarding } from '../screens/Onboarding';
import { PickCook } from '../screens/PickCook';
import { FullScreenMessage } from './FullScreenMessage';

// Auth is a render gate, not a route: there's no URL to bypass it from, and BottomNav (rendered
// only once every gate has passed) never flashes. `useAuth()` is called unconditionally in every
// gate below — even in local mode, where AuthProvider is still mounted but stays inert — so
// hook order never depends on isSupabaseConfigured.

export function AuthGate({ children }: { children: ReactNode }) {
  const { loading, session } = useAuth();
  if (!isSupabaseConfigured) return <>{children}</>;
  if (loading) return <FullScreenMessage text="טוען..." />;
  if (!session) return <Auth />;
  return <>{children}</>;
}

export function MembershipGate({ children }: { children: ReactNode }) {
  const { membership, membershipLoading } = useAuth();
  if (!isSupabaseConfigured) return <>{children}</>;
  if (!membership && membershipLoading) return <FullScreenMessage text="טוען..." />;
  if (!membership) return <Onboarding />;
  return <>{children}</>;
}

/** Sits *inside* AppProvider, not beside MembershipGate: picking a cook needs `state.cooks` and
 * may dispatch ADD_COOK for a brand-new one, both only available once the restaurant's state is
 * loaded. A membership always exists here (MembershipGate already guaranteed it) — only its
 * `cookId` can still be unset, right after joining/creating a restaurant. */
export function CookGate({ children }: { children: ReactNode }) {
  const { membership } = useAuth();
  if (!isSupabaseConfigured) return <>{children}</>;
  if (membership && !membership.cookId) return <PickCook />;
  return <>{children}</>;
}
