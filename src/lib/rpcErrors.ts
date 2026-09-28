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
    if (err.message.includes('last_chef')) return 'לא ניתן להוריד את השף האחרון מתפקידו';
    if (err.message.includes('cannot_remove_self')) return 'לא ניתן להסיר את עצמך';
    return 'אין הרשאה לפעולה הזו';
  }
  return err.message;
}
