import { INSTALL_HINT_KEY } from './resetLocalData';

/**
 * Whether to offer "add to home screen" — and only for the one platform that cannot do it for us.
 *
 * Android's browser offers an install prompt of its own; iOS has none, and no API a page can call:
 * the person has to open the share sheet themselves. So the app can only *explain*, and only where
 * the explanation is true: an iPhone or iPad, in a browser tab, not already running from the icon.
 *
 * Pure on purpose (an environment snapshot in, a boolean out) so it can be unit-tested in node,
 * like everything else here; `useInstallHint` reads the real `window`.
 */
export type InstallEnv = {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  /** `navigator.standalone` — Safari's own flag, true when launched from the home-screen icon. */
  standalone?: boolean;
  /** `matchMedia('(display-mode: standalone)')` — the standard equivalent. */
  displayModeStandalone?: boolean;
};

export function isIosDevice(env: InstallEnv): boolean {
  if (/iPhone|iPad|iPod/.test(env.userAgent)) return true;
  // iPadOS 13+ reports itself as a Mac; a Mac with a touchscreen is an iPad.
  return env.platform === 'MacIntel' && (env.maxTouchPoints ?? 0) > 1;
}

/** In-app browsers (a feed's built-in browser, a search app) have no "add to home screen" at all,
 * so showing the steps there sends the person looking for a button that does not exist. WhatsApp's
 * own viewer cannot be told apart from Safari by its user agent — that case simply shows the steps. */
const IN_APP_BROWSER = /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|Snapchat|TikTok|Twitter|GSA\//;

export function installHintApplies(env: InstallEnv): boolean {
  if (!isIosDevice(env)) return false;
  if (env.standalone === true || env.displayModeStandalone === true) return false;
  return !IN_APP_BROWSER.test(env.userAgent);
}

/** The environment of the page this is running in. Server-side or odd runtimes get "not iOS". */
export function currentInstallEnv(): InstallEnv {
  if (typeof navigator === 'undefined') return { userAgent: '' };
  let displayModeStandalone = false;
  try {
    displayModeStandalone = window.matchMedia('(display-mode: standalone)').matches;
  } catch {
    // no matchMedia: the `standalone` flag below still covers iOS
  }
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone: (navigator as Navigator & { standalone?: boolean }).standalone,
    displayModeStandalone,
  };
}

export function readInstallHintDismissed(): boolean {
  try {
    return localStorage.getItem(INSTALL_HINT_KEY) === '1';
  } catch {
    return false; // storage unavailable (private mode): the card simply keeps showing
  }
}

export function writeInstallHintDismissed(): void {
  try {
    localStorage.setItem(INSTALL_HINT_KEY, '1');
  } catch {
    // nothing to do: not being able to remember "not now" is not worth a message
  }
}
