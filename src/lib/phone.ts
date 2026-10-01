/**
 * Turning a phone number a person typed into links that open the right app. Kept pure: the numbers
 * come in as 050-1234567, +972 50 123 4567 or (03) 123-4567 (see `validatePhone`), and the two
 * link schemes want different shapes of the same number.
 */

/** `tel:` takes digits and a leading `+`; the dashes and spaces a person typed only get in the way. */
export function telHref(phone: string): string {
  const trimmed = phone.trim();
  const plus = trimmed.startsWith('+') ? '+' : '';
  return `tel:${plus}${trimmed.replace(/\D/g, '')}`;
}

/** wa.me wants the full international number with no `+` and no leading zero. A local Israeli
 * number (`05…`, `03…`) is completed with 972; anything already international is left alone. */
export function whatsappHref(phone: string): string {
  const trimmed = phone.trim();
  let digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+') || digits.startsWith('00')) {
    digits = digits.replace(/^00/, '');
  } else if (digits.startsWith('0')) {
    digits = `972${digits.slice(1)}`;
  }
  return `https://wa.me/${digits}`;
}
