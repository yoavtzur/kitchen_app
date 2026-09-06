// A minimal injectable key-value store so the sync engine's persistence can be exercised with
// an in-memory Map in node (no jsdom, no localStorage stub), while the real app uses the browser's.
export type KVStore = {
  get(key: string): string | null;
  set(key: string, value: string): void;
};

export function localStorageStore(): KVStore {
  return {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        // storage unavailable (private mode, quota) — silently skip, matching storage.ts
      }
    },
  };
}

export function memoryStore(initial: Record<string, string> = {}): KVStore {
  const data = new Map(Object.entries(initial));
  return {
    get: (key) => data.get(key) ?? null,
    set: (key, value) => void data.set(key, value),
  };
}
