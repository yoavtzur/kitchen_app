import { ChatIcon, PhoneIcon } from './icons';
import { telHref, whatsappHref } from '../lib/phone';

/** Call and WhatsApp for one number — the two things a person does with a teammate's phone. Plain
 * links (`tel:` / `wa.me`), so nothing here needs a permission or an API, and the number itself
 * is shown beside them for anyone who would rather copy it. */
export function ContactActions({ phone }: { phone: string }) {
  return (
    <div className="contact-actions">
      <a className="contact-phone" href={telHref(phone)} dir="ltr">
        {phone}
      </a>
      <a className="btn btn-icon" href={telHref(phone)} aria-label={`התקשר ל-${phone}`}>
        <PhoneIcon size={20} />
      </a>
      <a
        className="btn btn-icon"
        href={whatsappHref(phone)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`וואטסאפ ל-${phone}`}
      >
        <ChatIcon size={20} />
      </a>
    </div>
  );
}
