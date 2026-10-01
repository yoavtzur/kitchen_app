import { useSync } from '../store/AppContext';
import { useDelayedVisible } from '../lib/useDelayedVisible';
import { isSupabaseConfigured } from '../lib/supabase';
import { syncIndicator } from '../lib/syncIndicator';
import { useTimedFlag } from '../lib/useTimedFlag';

/**
 * The quiet half of the sync chrome: a small dot beside a screen's title.
 *
 * It exists for the walk-in. A cook counting stock with no signal needs to know their numbers
 * are safe, not to be handed a banner about it — so offline-with-nothing-waiting is grey,
 * something-waiting-to-send is amber, and neither blocks anything on screen. Tapping the dot
 * spells the state out for a few seconds; the words are also its accessible name.
 *
 * Healthy renders nothing, and a non-healthy state is debounced by 1s so a routine reconnect
 * never flashes a dot. States that need a person (refresh, stuck queue, error) are *not* a dot —
 * see `SyncBadge`.
 */
export function SyncDot() {
  const info = useSync();
  const indicator = syncIndicator(info);
  const shouldShow = indicator.kind === 'dot';
  const visible = useDelayedVisible(shouldShow, 1000);
  const [explained, explain] = useTimedFlag(4000);

  if (!isSupabaseConfigured || !visible || indicator.kind !== 'dot') return null;

  return (
    <span className="sync-dot" role="status">
      <button type="button" className="sync-dot-btn" aria-label={indicator.label} onClick={() => explain()}>
        <span className={`dot ${indicator.tone}`} />
      </button>
      {explained && <span className="sync-dot-label">{indicator.label}</span>}
    </span>
  );
}
