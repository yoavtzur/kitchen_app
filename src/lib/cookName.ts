/**
 * What a new cook types when asking to join — validated and tidied in one place, so the form, the
 * tests and the server's own limits (`join_requests` checks, migration 0008) agree: names are 1 to
 * 40 characters, the phone is optional and at most 20.
 */

export const NAME_MAX = 40;
export const PHONE_MAX = 20;

export type JoinDetails = { first: string; last: string; phone?: string };

const tidy = (s: string) => s.trim().replace(/\s+/g, ' ');

export function validateJoinDetails(
  input: { first: string; last: string; phone: string },
): { ok: true; value: JoinDetails } | { ok: false; error: string } {
  const first = tidy(input.first);
  const last = tidy(input.last);
  if (!first) return { ok: false, error: 'נא להזין שם פרטי' };
  if (!last) return { ok: false, error: 'נא להזין שם משפחה' };
  if (first.length > NAME_MAX || last.length > NAME_MAX) {
    return { ok: false, error: `שם יכול להכיל עד ${NAME_MAX} תווים` };
  }

  const phone = validatePhone(input.phone);
  if (!phone.ok) return phone;
  return { ok: true, value: phone.value ? { first, last, phone: phone.value } : { first, last } };
}

/** An optional phone number: empty is fine and means "none". Shared by the join form and the
 * profile screen so both accept and refuse exactly the same numbers. */
export function validatePhone(raw: string): { ok: true; value: string | undefined } | { ok: false; error: string } {
  const phone = raw.trim();
  if (!phone) return { ok: true, value: undefined };
  // Loose on purpose: Israeli numbers come as 050-1234567, +972 50 123 4567 or (03) 123-4567, and
  // a strict pattern would turn away a real number over punctuation. It only has to look like one.
  if (!/^[0-9+\-()\s]+$/.test(phone) || phone.replace(/\D/g, '').length < 7 || phone.length > PHONE_MAX) {
    return { ok: false, error: 'מספר הטלפון אינו תקין' };
  }
  return { ok: true, value: phone };
}

/** The `Cook` name an approved request becomes. */
export function cookNameOf(first: string, last: string): string {
  return tidy(`${first} ${last}`);
}
