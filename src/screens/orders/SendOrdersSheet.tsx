import { BottomSheet } from '../../components/BottomSheet';
import { useTimedMessage } from '../../lib/useTimedFlag';
import type { SupplierMessage } from '../../lib/orders';
import { useApp } from '../../store/AppContext';
import { supplierByName, whatsappSendHref } from '../../lib/suppliers';

/**
 * What follows "אשר הכל": the order is saved, and here is one message per supplier ready to send.
 * A delivery is arranged supplier by supplier, so each gets its own button instead of one long
 * list the chef has to cut up. WhatsApp opens with the text filled in — straight into the
 * supplier's own chat when their card (Suppliers screen) has a phone, else at WhatsApp's contact
 * picker. Sending is deliberately left to the person: nothing leaves the building without a tap.
 */
export function SendOrdersSheet({ messages, onClose }: { messages: SupplierMessage[]; onClose: () => void }) {
  const [copied, showCopied] = useTimedMessage(1800);
  const { state } = useApp();

  async function copy(m: SupplierMessage) {
    try {
      await navigator.clipboard.writeText(m.text);
      showCopied(m.supplier);
    } catch {
      // clipboard unavailable — the text is still one tap away in WhatsApp
    }
  }

  return (
    <BottomSheet title="ההזמנה נשמרה ✓" onClose={onClose}>
      <p className="muted" style={{ marginBottom: 'var(--space-3)' }}>
        שלחו לכל ספק את ההזמנה שלו:
      </p>
      <div className="stack-gap-2">
        {messages.map((m) => (
          <div key={m.supplier} className="send-row">
            <div className="send-row-name">
              <strong>{m.supplier}</strong>
              <span className="muted">{m.count} פריטים</span>
            </div>
            <a
              className="btn btn-primary"
              href={whatsappSendHref(supplierByName(state, m.supplier)?.phone, m.text)}
              target="_blank"
              rel="noopener noreferrer"
            >
              וואטסאפ
            </a>
            <button type="button" className="btn" onClick={() => copy(m)}>
              {copied === m.supplier ? 'הועתק ✓' : 'העתק'}
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="btn btn-block" style={{ marginTop: 'var(--space-4)' }} onClick={onClose}>
        סיום
      </button>
    </BottomSheet>
  );
}
