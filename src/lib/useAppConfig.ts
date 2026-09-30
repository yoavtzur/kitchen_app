import { useSyncExternalStore } from 'react';
import { getAppConfig, subscribeAppConfig, type AppConfig } from './appConfig';

/**
 * The current remote config, or `null` when we have no trustworthy answer — which every caller
 * must read as "no restriction". See the note at the top of appConfig.ts for why this fails
 * open rather than closed.
 *
 * In its own file so `appConfig.ts` stays free of React and can be tested as plain functions in
 * node, like the rest of `lib/`.
 */
export function useAppConfig(): AppConfig | null {
  return useSyncExternalStore(subscribeAppConfig, getAppConfig, () => null);
}
