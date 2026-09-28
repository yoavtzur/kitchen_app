import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useApp, useSync } from '../store/AppContext';
import { isSupabaseConfigured } from '../lib/supabase';
import { setTag } from '../lib/sentry';

/**
 * Keeps Sentry's tags in step with the app. Renders nothing; it is a sibling of `SyncBadge`
 * inside every gate, which is the shallowest place that can see auth, sync and routing at once.
 *
 * **Everything here is an identifier or an enum — never content.** Notably `userId` is the
 * account UUID and never `session.user.email`, which sits right there on the same object and
 * would be the single most damaging field this app could leak. That omission is the point of
 * the whole file.
 */
export function SentryContext() {
  const { session, membership } = useAuth();
  const { state } = useApp();
  const { status, pendingCount } = useSync();
  const { pathname } = useLocation();

  useEffect(() => {
    setTag('mode', isSupabaseConfigured ? 'remote' : 'local');
  }, []);

  useEffect(() => {
    setTag('userId', session?.user.id);
    setTag('restaurantId', membership?.restaurantId);
    setTag('role', membership?.role);
  }, [session?.user.id, membership?.restaurantId, membership?.role]);

  useEffect(() => {
    setTag('syncStatus', status);
    setTag('pendingCount', pendingCount);
  }, [status, pendingCount]);

  useEffect(() => {
    setTag('schemaVersion', state.schemaVersion);
  }, [state.schemaVersion]);

  useEffect(() => {
    setTag('route', pathname);
  }, [pathname]);

  return null;
}
