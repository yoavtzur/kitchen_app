import { FullScreenMessage } from './FullScreenMessage';

/** Shown only on a device's very first connection to a restaurant, while the initial snapshot
 * and op log are fetched — see the `ready` gate in AppContext.tsx. Never shown in local mode
 * (always synchronously ready) or on a returning device (warm from its own cache). */
export function BootScreen() {
  return <FullScreenMessage text="טוען..." />;
}
