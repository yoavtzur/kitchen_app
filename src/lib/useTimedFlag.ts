import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A boolean that turns itself back off after `ms` — the "הועתק ✓" / "נשמר ✓" confirmation pattern.
 *
 * Seven screens had grown their own copy of this as a `useState` plus a bare `setTimeout`, and
 * every one of them shared the same two bugs. The timer was never cleared, so a cook who saved a
 * count and immediately navigated away left a timer holding a setter for an unmounted component;
 * and triggering twice in quick succession left the *first* timer running, which turned the flag
 * off early, mid-way through the second confirmation. Both are fixed here once.
 *
 * Returns the flag and a `trigger` that is stable across renders, so it is safe in a dependency
 * array and in a callback passed to a memoized child.
 *
 * Deliberately a hook over plain state and not a context provider: `CrashScreen` uses it, and
 * `CrashScreen` must call no app hook at all (`useApp`/`useAuth`/`useSync` are exactly what may
 * have thrown by the time it renders). This file imports nothing but React, which is what keeps
 * it usable from there.
 */
export function useTimedFlag(ms: number): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const trigger = useCallback(() => {
    clear();
    setOn(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setOn(false);
    }, ms);
  }, [clear, ms]);

  // Cleanup only — the flag is never started by mounting, always by a user action.
  useEffect(() => clear, [clear]);

  return [on, trigger];
}

/**
 * The same thing for a message rather than a flag: the text to show, and a `show(text)`.
 *
 * Separate from `useTimedFlag` instead of generic over the value because the two read differently
 * at the call site — `if (saved)` against `if (message)` — and a single hook returning
 * `T | null` would make every boolean caller write `=== true`.
 */
export function useTimedMessage(ms: number): [string, (text: string) => void] {
  const [message, setMessage] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const show = useCallback(
    (text: string) => {
      clear();
      setMessage(text);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setMessage('');
      }, ms);
    },
    [clear, ms],
  );

  useEffect(() => clear, [clear]);

  return [message, show];
}
