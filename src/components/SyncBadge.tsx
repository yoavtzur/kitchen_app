import { useSync } from '../store/AppContext';
import { useDelayedVisible } from '../lib/useDelayedVisible';
import { isSupabaseConfigured } from '../lib/supabase';
import { syncIndicator } from '../lib/syncIndicator';

/** The loud half of the sync chrome: a pill with words, for the states that need a person —
 * refresh the app, a stuck queue, an error, read-only mode. Everything that needs no action
 * (offline in a walk-in, changes waiting to send) is the quiet `SyncDot` in the screen header
 * instead, which is why this renders nothing for those.
 *
 * Renders nothing in local mode — there's no restaurant to sync with, so any sync chrome there
 * would just be confusing noise — and is debounced by 1s so a routine reconnect never flashes. */
export function SyncBadge() {
  const info = useSync();
  const indicator = syncIndicator(info);
  const shouldShow = indicator.kind === 'pill';
  const visible = useDelayedVisible(shouldShow, 1000);

  if (!isSupabaseConfigured || !visible || indicator.kind !== 'pill') return null;
  return <div className={`pill ${indicator.tone} sync-badge`}>{indicator.label}</div>;
}
