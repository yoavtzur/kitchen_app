import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth, type JoinRequestRow } from './AuthContext';
import { usePermissions } from './usePermissions';
import { isSupabaseConfigured } from '../lib/supabase';

const POLL_MS = 60_000;
// Coming back to the tab fires `focus` and `visibilitychange` together, and a phone fires both on
// every unlock. One fetch is enough.
const FOCUS_THROTTLE_MS = 15_000;

/**
 * The people waiting for this chef to let them in. Fetches on mount, when the app regains focus
 * (throttled) and every minute — and that is the whole mechanism, deliberately. Realtime would be
 * a latency optimisation at best (the project's own rule for sync: correctness comes from
 * re-fetching, realtime only makes it quicker), and a minute is plenty for "someone is asking to
 * join". Does nothing for a cook, and nothing in local mode, where there are no accounts.
 */
export function useJoinRequests(): {
  requests: JoinRequestRow[];
  error: string | null;
  reload: () => Promise<void>;
  /** Removes a row locally once it has been answered, without waiting for the next fetch. */
  drop: (userId: string) => void;
} {
  const { listJoinRequests, membership } = useAuth();
  const { isChef } = usePermissions();
  const enabled = isSupabaseConfigured && isChef && Boolean(membership);
  const [requests, setRequests] = useState<JoinRequestRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const lastRun = useRef(0);
  const mounted = useRef(true);

  const reload = useCallback(async () => {
    if (!enabled) return;
    lastRun.current = Date.now();
    const result = await listJoinRequests();
    if (!mounted.current) return;
    setError(result.error);
    // On a failed fetch keep what is shown: a request that was there a minute ago is still there.
    if (!result.error) setRequests(result.requests);
  }, [enabled, listJoinRequests]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    // Deferred out of the effect body: it is a fetch whose result sets state, not a synchronous
    // state update during commit.
    void Promise.resolve().then(reload);
    const interval = setInterval(reload, POLL_MS);
    const onFocus = () => {
      if (document.visibilityState === 'hidden') return;
      if (Date.now() - lastRun.current < FOCUS_THROTTLE_MS) return;
      void reload();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [enabled, reload]);

  return {
    requests: enabled ? requests : [],
    error: enabled ? error : null,
    reload,
    drop: (userId) => setRequests((prev) => prev.filter((r) => r.userId !== userId)),
  };
}
