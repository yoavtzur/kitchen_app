// Postgres/PostgREST error codes → Hebrew a cook can act on.
//
// Lifted out of AuthContext (its only caller until now) because Settings' backup import calls
// an RPC too — `reset_snapshot` — and was rendering `error.message` raw: an English Postgres
// string, sometimes with the offending value quoted into it. Two callers means one mapper.
export type RpcErrorLike = { code?: string; message: string };

export function mapRpcError(err: RpcErrorLike): string {
  if (err.code === 'P0002') {
    // `resolve_join_request` raises this when two devices (or a double tap) race to answer the
    // same request. It is not a code problem, and "code not found" would send the chef looking
    // for one.
    if (err.message.includes('no_such_request')) return 'הבקשה כבר טופלה';
    return 'קוד לא נמצא';
  }
  // `create_invite` caps open invitations per kitchen.
  if (err.code === '54000') return 'יש יותר מדי הזמנות פתוחות. אפשר ליצור חדשה כשאחת מהן תפוג או תנוצל.';
  if (err.code === '23505') return 'החשבון כבר משויך למטבח';
  if (err.code === '42501') {
    // Checked before the plain `last_chef` case below, which is a substring of this one: the two
    // are different situations with different remedies, and the wrong message here tells a chef
    // to do something that isn't what they were trying to do.
    if (err.message.includes('last_chef_account')) {
      return 'את/ה השף היחיד במטבח. מנו שף נוסף לפני מחיקת החשבון.';
    }
    if (err.message.includes('last_chef')) return 'לא ניתן להוריד את השף האחרון מתפקידו';
    if (err.message.includes('cannot_remove_self')) return 'לא ניתן להסיר את עצמך';
    if (err.message.includes('chef_only')) return 'רק שף יכול לבצע את הפעולה הזו';
    return 'אין הרשאה לפעולה הזו';
  }
  // A migration that hasn't been pasted into the SQL editor yet. Says so, rather than showing
  // PostgREST's "Could not find the function public.x in the schema cache" to a cook.
  if (err.code === 'PGRST202') return 'הפעולה עדיין לא זמינה בשרת. יש להשלים את עדכון מסד הנתונים.';
  return err.message;
}

/**
 * `request_join`'s `status` column → Hebrew, or `null` when the request was recorded (`pending`).
 *
 * Separate from `mapRpcError` because these are not errors: the RPC **returns** them rather than
 * raising, and that is load-bearing rather than stylistic. Raising aborts the transaction, which
 * would roll back the attempt counter the refusal was based on — so a rate limiter that refused by
 * raising counted nothing and limited nothing. See the long comments in migrations 0007 and 0008,
 * and `scripts/verify-migrations-local.sh`, which is what caught it the first time.
 *
 * `pending` is the only success, and an unrecognised status is a refusal: it means a server newer
 * than this build, and the one thing known about it is that it did not say `pending`. Treating it
 * as success would put someone on a waiting screen for a request that was never recorded.
 */
export function mapRequestJoinStatus(status: unknown): string | null {
  if (status === 'pending') return null;
  if (status === 'invalid_code') return 'קוד לא נמצא';
  if (status === 'invalid_invite') return 'הקישור כבר לא תקף. בקשו מהשף קישור חדש.';
  if (status === 'invalid_name') return 'נא למלא שם פרטי ושם משפחה.';
  if (status === 'already_member') return 'החשבון כבר משויך למטבח';
  if (status === 'full') return 'יש כרגע יותר מדי בקשות ממתינות במטבח הזה. בקשו מהשף לטפל בהן ונסו שוב.';
  if (status === 'rate_limited') return 'יותר מדי ניסיונות הצטרפות. נסו שוב מאוחר יותר.';
  return 'ההצטרפות נכשלה. נסו שוב.';
}

/** `peek_invite`'s status → what to tell someone about to use a link, or `null` for a usable one. */
export function mapInviteStatus(status: unknown): string | null {
  if (status === 'valid') return null;
  if (status === 'expired') return 'הקישור פג תוקף. בקשו מהשף קישור חדש.';
  if (status === 'used') return 'הקישור כבר נוצל. בקשו מהשף קישור חדש.';
  return 'הקישור אינו תקין. בקשו מהשף קישור חדש.';
}
