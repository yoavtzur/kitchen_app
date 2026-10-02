import { useCallback, useState } from 'react';
import {
  currentInstallEnv,
  installHintApplies,
  readInstallHintDismissed,
  writeInstallHintDismissed,
} from './installHint';

/**
 * `applies`: this device could add the app to its home screen and has not yet (decided once per
 * mount — launching from the icon is a new page load, so it cannot change under a live screen).
 * `dismissed`: the person said "לא עכשיו" on the card. The menu entry ignores that; the card obeys it.
 */
export function useInstallHint() {
  const [applies] = useState(() => installHintApplies(currentInstallEnv()));
  const [dismissed, setDismissed] = useState(readInstallHintDismissed);
  const dismiss = useCallback(() => {
    writeInstallHintDismissed();
    setDismissed(true);
  }, []);
  return { applies, dismissed, dismiss };
}
