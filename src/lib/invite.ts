import { INVITE_KEY } from './resetLocalData';

/**
 * Everything about an invitation link that can be decided without a network or a browser: what a
 * token looks like, how the link and its WhatsApp message are built.
 *
 * The token is the `create_invite()` result — 32 hex characters, shown to the chef exactly once.
 * It rides in the URL **hash**, not the path: this app is a `HashRouter` on a static host, and a
 * fragment is also never sent to the server in a request line, which keeps a one-time secret out
 * of access logs.
 */

const TOKEN_RE = /^[0-9a-f]{32}$/i;

/** The token if `raw` is shaped like one, else null. Lower-cased, because hex is not case
 * sensitive and a link retyped by hand or mangled by a chat app should still work. A filter for
 * junk, not a check of validity — only the server knows that. */
export function parseInviteToken(raw: string | null | undefined): string | null {
  const t = (raw ?? '').trim();
  return TOKEN_RE.test(t) ? t.toLowerCase() : null;
}

/** `origin` and `pathname` come from `window.location`; passed in so this stays testable in node. */
export function buildInviteLink(origin: string, pathname: string, token: string): string {
  return `${origin}${pathname}#/join/${token}`;
}

export function inviteMessage(restaurantName: string | undefined, link: string): string {
  const name = restaurantName?.trim();
  return `${name ? `הוזמנת להצטרף למטבח ${name}` : 'הוזמנת להצטרף למטבח'} — הקישור תקף 72 שעות ומשמש אדם אחד:\n${link}`;
}

/** Opens WhatsApp with the message pre-filled; the chef picks the recipient. Same mechanism as
 * the order sheet's share button. */
export function buildWhatsAppUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

// --- the token between opening the link and finishing sign-up ---------------------------------
// Sign-up can take a minute (a password manager, a captcha), and a reload in the middle must not
// lose the invitation, so it is held in localStorage — and removed the moment it is spent.

export function readPendingInvite(): string | null {
  try {
    return parseInviteToken(localStorage.getItem(INVITE_KEY));
  } catch {
    return null; // storage unavailable: the person falls back to typing the code
  }
}

export function writePendingInvite(token: string | null): void {
  try {
    if (token) localStorage.setItem(INVITE_KEY, token);
    else localStorage.removeItem(INVITE_KEY);
  } catch {
    // nothing to do: the link simply has to be opened again
  }
}
