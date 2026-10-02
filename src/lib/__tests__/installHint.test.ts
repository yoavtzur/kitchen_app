import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  installHintApplies,
  isIosDevice,
  readInstallHintDismissed,
  writeInstallHintDismissed,
  type InstallEnv,
} from '../installHint';
import { INSTALL_HINT_KEY } from '../resetLocalData';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1';
const IPHONE_INSTAGRAM =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 340.0.0.0';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

const env = (over: Partial<InstallEnv>): InstallEnv => ({ userAgent: IPHONE_SAFARI, ...over });

describe('installHintApplies', () => {
  it('is on for an iPhone in Safari, and for Chrome on iOS', () => {
    expect(installHintApplies(env({}))).toBe(true);
    expect(installHintApplies(env({ userAgent: IPHONE_CHROME }))).toBe(true);
  });

  it('is off once launched from the home-screen icon, by either signal', () => {
    expect(installHintApplies(env({ standalone: true }))).toBe(false);
    expect(installHintApplies(env({ displayModeStandalone: true }))).toBe(false);
    expect(installHintApplies(env({ standalone: false, displayModeStandalone: false }))).toBe(true);
  });

  it('is off for Android and desktop, which install some other way', () => {
    expect(installHintApplies(env({ userAgent: ANDROID_CHROME }))).toBe(false);
    expect(installHintApplies(env({ userAgent: MAC_SAFARI, platform: 'MacIntel', maxTouchPoints: 0 }))).toBe(false);
  });

  it('is off inside an in-app browser, which has no add-to-home-screen to point at', () => {
    expect(installHintApplies(env({ userAgent: IPHONE_INSTAGRAM }))).toBe(false);
  });
});

describe('isIosDevice', () => {
  it('recognises an iPad that presents itself as a Mac, by its touchscreen', () => {
    expect(isIosDevice({ userAgent: MAC_SAFARI, platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
  });
});

// No jsdom in this repo: a minimal in-memory localStorage is all the module needs.
describe('dismissal', () => {
  const data = new Map<string, string>();
  beforeEach(() => {
    data.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('is not dismissed until the person says so, then stays dismissed', () => {
    expect(readInstallHintDismissed()).toBe(false);
    writeInstallHintDismissed();
    expect(data.get(INSTALL_HINT_KEY)).toBe('1');
    expect(readInstallHintDismissed()).toBe(true);
  });

  it('survives storage that throws: the card just keeps showing', () => {
    const blocked = () => {
      throw new Error('blocked');
    };
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: blocked, setItem: blocked, removeItem: blocked };
    expect(readInstallHintDismissed()).toBe(false);
    expect(() => writeInstallHintDismissed()).not.toThrow();
  });
});
