// Postgres/PostgREST error codes → Hebrew a cook can act on.
//
// Lifted out of AuthContext (its only caller until now) because Settings' backup import calls
// an RPC too — `reset_snapshot` — and was rendering `error.message` raw: an English Postgres
// string, sometimes with the offending value quoted into it. Two callers means one mapper.
export type RpcErrorLike = { code?: string; message: string };

export function mapRpcError(err: RpcErrorLike): string {
  if (err.code === 'P0002') return 'קוד לא נמצא';
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
 * `join_restaurant`'s `status` column → Hebrew, or `null` when the join succeeded.
 *
 * Separate from `mapRpcError` because these are not errors: the RPC **returns** them rather than
 * raising, and that is load-bearing rather than stylistic. Raising aborts the transaction, which
 * would roll back the attempt counter the refusal was based on — so a rate limiter that refused by
 * raising counted nothing and limited nothing. See the long comment on `join_restaurant` in
 * migration 0007, and `scripts/verify-migrations-local.sh`, which is what caught it.
 *
 * `restaurantId` is read only to stay compatible with a server that **does not have 0007 yet**.
 * That matters because merging to `main` deploys immediately while migrations are applied by hand:
 * for the window in between, this build talks to the old two-column function, where there is no
 * `status` at all. The old function signalled every refusal by raising — which surfaces as `error`
 * and never reaches here — so a returned row carrying a real restaurant id is unambiguously a
 * success. Checking the id rather than merely the row's presence is what keeps that from
 * degenerating back into "trust anything that came back": under the *new* shape a refusal does
 * return a row, and its id is null.
 */
export function mapJoinStatus(status: unknown, restaurantId: unknown): string | null {
  if (status === null || status === undefined) {
    return restaurantId ? null : 'ההצטרפות נכשלה. נסו שוב.';
  }
  if (status === 'ok') return null;
  if (status === 'invalid_code') return 'קוד לא נמצא';
  if (status === 'rate_limited') return 'יותר מדי ניסיונות הצטרפות. נסו שוב מאוחר יותר.';
  // An unrecognised status means a server newer than this build. Refusing is the safe read: the
  // one thing we know is that it did not say 'ok'.
  return 'ההצטרפות נכשלה. נסו שוב.';
}
