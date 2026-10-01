import { BottomSheet } from './BottomSheet';
import { buildWhatsAppUrl, inviteMessage } from '../lib/invite';
import { useTimedFlag } from '../lib/useTimedFlag';

/**
 * What the chef sees after pressing "הזמן טבח": the link, ready to send.
 *
 * Two taps from the button to a sent message — the whole interaction is "make a link" and "send
 * it", with nothing to fill in. Everything the cook has to type, they type themselves; the chef's
 * control over who actually gets in is the approval that follows, not anything done here.
 */
export function InviteCookSheet({
  link,
  restaurantName,
  onClose,
}: {
  link: string;
  restaurantName?: string;
  onClose: () => void;
}) {
  const [copied, flagCopied] = useTimedFlag(1800);
  const message = inviteMessage(restaurantName, link);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      flagCopied();
    } catch {
      // clipboard unavailable — the link is on screen to copy by hand
    }
  }

  return (
    <BottomSheet title="הזמנת טבח" onClose={onClose}>
      <div className="stack-gap-3">
        <p className="muted">
          הקישור תקף 72 שעות ומשמש טבח אחד. אחרי שהטבח ימלא את פרטיו תקבלו כאן בקשה לאשר אותו.
        </p>
        <a
          className="btn btn-primary btn-block"
          href={buildWhatsAppUrl(message)}
          target="_blank"
          rel="noopener noreferrer"
        >
          שתף בוואטסאפ
        </a>
        <button type="button" className="btn btn-block" onClick={copy}>
          {copied ? 'הועתק ✓' : 'העתק קישור'}
        </button>
        <input
          readOnly
          dir="ltr"
          value={link}
          aria-label="קישור הזמנה"
          onFocus={(e) => e.currentTarget.select()}
          style={{ fontSize: 13 }}
        />
      </div>
    </BottomSheet>
  );
}
