import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { AppState } from '../types';
import type { Action } from './reducer';
import { useAuth } from '../auth/AuthContext';
import { isSupabaseConfigured } from '../lib/supabase';
import { getDeviceId } from '../lib/ids';
import { localStorageStore } from '../sync/persist';
import { createSupabaseAdapter } from '../sync/supabaseAdapter';
import {
  createLocalSyncStore,
  createRemoteSyncStore,
  getSyncStore,
  type SyncInfo,
  type SyncStore,
} from '../sync/store';
import { BootScreen } from '../components/BootScreen';

type AppContextValue = {
  state: AppState;
  dispatch: React.Dispatch<Action>;
};

const AppContext = createContext<AppContextValue | undefined>(undefined);
const SyncStoreContext = createContext<SyncStore | undefined>(undefined);

/**
 * Picks the store for the current identity. No restaurant (local mode, or Supabase configured
 * but — impossible in practice, since MembershipGate blocks first — no membership yet) gets the
 * one local, unkeyed store; a real restaurant gets its own store, keyed by id so switching
 * accounts on a shared device can't bleed one restaurant's data into another's.
 */
function resolveStore(restaurantId: string | undefined): SyncStore {
  if (isSupabaseConfigured && restaurantId) {
    return getSyncStore(`remote:${restaurantId}`, () =>
      createRemoteSyncStore(
        createSupabaseAdapter(restaurantId, getDeviceId()),
        localStorageStore(),
        `kitchen-sync-${restaurantId}`,
      ),
    );
  }
  return getSyncStore('local', createLocalSyncStore);
}

export function AppProvider({ children }: { children: ReactNode }) {
  const { membership } = useAuth();
  const store = resolveStore(membership?.restaurantId);
  const state = useSyncExternalStore(store.subscribe, () => store.getState().display);
  const ready = useSyncExternalStore(store.subscribe, () => store.getState().ready);

  if (!ready) return <BootScreen />;

  return (
    <SyncStoreContext.Provider value={store}>
      <AppContext.Provider value={{ state, dispatch: store.dispatch }}>{children}</AppContext.Provider>
    </SyncStoreContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

/** Sync status for a small UI indicator — separate from useApp() so screens that only read app
 * data don't re-render on every status tick. In local mode this is always
 * `{status:'live', online:true, pendingCount:0}`, since nothing is ever actually in flight. */
export function useSync(): SyncInfo {
  const store = useContext(SyncStoreContext);
  if (!store) throw new Error('useSync must be used within AppProvider');
  return useSyncExternalStore(store.subscribe, () => store.getSyncInfo());
}
