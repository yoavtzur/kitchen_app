import { useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { isSupabaseConfigured } from '../lib/supabase';
import { useAppConfig } from '../lib/useAppConfig';
import { Auth } from '../screens/Auth';
import { JoinRejected } from '../screens/JoinRejected';
import { PendingApproval } from '../screens/PendingApproval';
import { ForgotPassword } from '../screens/ForgotPassword';
import { NewPassword } from '../screens/NewPassword';
import { Onboarding } from '../screens/Onboarding';
import { PickCook } from '../screens/PickCook';
import { FullScreenMessage } from './FullScreenMessage';

// Auth is a render gate, not a route: there's no URL to bypass it from, and BottomNav (rendered
// only once every gate has passed) never flashes. `useAuth()` is called unconditionally in every
// gate below — even in local mode, where AuthProvider is still mounted but stays inert — so
// hook order never depends on isSupabaseConfigured.

export function AuthGate({ children }: { children: ReactNode }) {
  const { loading, session, recovering } = useAuth();
  // Which signed-out screen to show. Local state, not a route, for the same reason the whole
  // gate isn't one (see above): there is no URL here to navigate to.
  const [view, setView] = useState<'signin' | 'forgot'>('signin');
  if (!isSupabaseConfigured) return <>{children}</>;
  if (loading) return <FullScreenMessage text="טוען..." />;
  // Checked before `session`: a reset link signs the user in, so they'd otherwise sail past this.
  if (recovering) return <NewPassword />;
  if (!session) {
    return view === 'forgot' ? (
      <ForgotPassword onBack={() => setView('signin')} />
    ) : (
      <Auth onForgotPassword={() => setView('forgot')} />
    );
  }
  return <>{children}</>;
}

export function MembershipGate({ children }: { children: ReactNode }) {
  const { membership, membershipLoading, joinStatus } = useAuth();
  if (!isSupabaseConfigured) return <>{children}</>;
  if (!membership && membershipLoading) return <FullScreenMessage text="טוען..." />;
  if (!membership) {
    // Asked to join and waiting on a chef — or turned down. Neither is a member, so neither sees
    // anything of the kitchen; both skip the onboarding form they have already filled in.
    if (joinStatus?.status === 'pending') return <PendingApproval />;
    if (joinStatus?.status === 'rejected') return <JoinRejected />;
    return <Onboarding />;
  }
  return <>{children}</>;
}

/**
 * Renders a maintenance notice in place of the app while `app_config.maintenance_mode` is on.
 *
 * Placed **above `AppProvider`** (MembershipGate > MaintenanceGate > AppProvider), and that
 * position is the whole point: no sync store is ever constructed, so not one op can be
 * dispatched. A check inside `maybeAppend` could only stop ops being *sent* — a dispatched op
 * would still land in `pending` and `display`, so a cook would keep "completing" tasks into a
 * queue that will never drain, and watch them all un-complete on the next reload.
 *
 * Below `AuthGate`, so signing in to check still works and password recovery is unaffected.
 *
 * `config === null` means we have no trustworthy answer, and that is treated as "carry on" —
 * see appConfig.ts.
 */
export function MaintenanceGate({ children }: { children: ReactNode }) {
  const config = useAppConfig();
  if (!isSupabaseConfigured) return <>{children}</>;
  if (!config?.maintenanceMode) return <>{children}</>;
  return (
    <FullScreenMessage
      text={config.maintenanceMessage?.trim() || 'האפליקציה בתחזוקה מתוכננת. ננסה שוב בעוד מספר דקות.'}
    />
  );
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

/** Renders `children` only for a chef; `fallback` (default: nothing) otherwise. No new provider
 * needed — AuthProvider already sits above every gate, so usePermissions reaches anywhere in
 * the tree. Client-side gating only; the real boundary is the append_ops RPC (see
 * supabase/migrations/0003_rls_and_granular_roles.sql). */
export function ChefOnly({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  const { isChef } = usePermissions();
  return <>{isChef ? children : fallback}</>;
}
