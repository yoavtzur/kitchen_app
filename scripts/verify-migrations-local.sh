#!/usr/bin/env bash
# Applies every supabase/migrations/*.sql to a throwaway local PostgreSQL and then tests what the
# RPCs actually *do*. NOT part of the app or the build.
#
#   ./scripts/verify-migrations-local.sh          # needs postgresql-16 (or any 14+) installed
#
# Why this exists, and why it is a shell script rather than one more .mjs: the other verify-*.mjs
# scripts talk to the live Supabase project, which means they can only be run after a migration has
# already been pasted into the SQL editor by hand. There was no way to test a migration *before*
# shipping it, and the consequence was a real bug that reached a commit: the join-attempt rate
# limiter in 0007 refused by `raise exception`, and RAISE aborts the transaction — rolling back the
# counter bump the refusal was based on. Every failed guess left scan_usage exactly as it found it.
# The limit was decoration, and it compiled, passed review, and read correctly.
#
# **The one thing that catches that class of bug is a separate transaction per call**, which is
# what PostgREST actually gives each RPC. Calling the same functions from inside one `DO` block
# hides it completely, because the exception handler's subtransaction rollback looks like success
# from the outside. So every RPC call below is its own `psql -c`.
#
# The auth schema here is a two-table stand-in, not Supabase's. It is enough for these functions
# (they use auth.uid() and delete from auth.users) and nothing more should be read into it.
set -uo pipefail

PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}
export PATH="$PGBIN:$PATH"
command -v initdb >/dev/null || { echo "no PostgreSQL found; set PGBIN=/path/to/pg/bin"; exit 1; }

REPO=$(cd "$(dirname "$0")/.." && pwd)
# Deliberately not under a scratch/tmp dir that a sandbox may re-chmod: postgres runs as its own
# user, and losing +x on a parent mid-checkpoint PANICs the server (seen, and very confusing).
PGROOT=${PGROOT:-/var/lib/postgresql/verify-migrations}
PORT=${PGPORT_TEST:-5433}
AS_PG=""
[ "$(id -u)" = "0" ] && AS_PG="su postgres -c"

run_pg() { if [ -n "$AS_PG" ]; then su postgres -c "PATH=$PGBIN:\$PATH $1"; else bash -c "$1"; fi; }

echo "== starting a throwaway cluster on port $PORT =="
# Stop a cluster left behind by an interrupted run. Without this, initdb succeeds, the new server
# fails to bind, and psql quietly connects to the OLD one — so the migrations run against a
# database that already has them, and every result afterwards is meaningless.
run_pg "pg_ctl -D $PGROOT/data -m immediate stop" >/dev/null 2>&1
if psql -h 127.0.0.1 -p "$PORT" -U postgres -tAqc 'select 1' >/dev/null 2>&1; then
  echo "something else is already listening on port $PORT; set PGPORT_TEST to a free one"; exit 1
fi
rm -rf "$PGROOT"; mkdir -p "$PGROOT"
[ -n "$AS_PG" ] && chown postgres:postgres "$PGROOT"
chmod 700 "$PGROOT"
# -U postgres: initdb names the superuser after the OS user, and everything below connects as
# "postgres". That only coincided when run as root via `su postgres`; a CI runner is not root.
run_pg "initdb -D $PGROOT/data -A trust -U postgres" >/dev/null 2>&1 || { echo "initdb failed"; exit 1; }
run_pg "pg_ctl -D $PGROOT/data -o '-k $PGROOT -p $PORT -h 127.0.0.1' -l $PGROOT/log start" >/dev/null
trap 'run_pg "pg_ctl -D $PGROOT/data -m immediate stop" >/dev/null 2>&1' EXIT
for _ in $(seq 20); do psql -h 127.0.0.1 -p "$PORT" -U postgres -tAqc 'select 1' >/dev/null 2>&1 && break; sleep 0.5; done

Q="psql -h 127.0.0.1 -p $PORT -U postgres -d kitchen -tAqX -v ON_ERROR_STOP=1"
psql -h 127.0.0.1 -p "$PORT" -U postgres -qc 'create database kitchen;' >/dev/null

$Q <<'SQL' >/dev/null
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as $fn$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid; $fn$;
-- Roles and publications are cluster-wide, not per-database, hence the guards: a second run
-- against a surviving cluster would otherwise fail on "already exists".
do $do$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $do$;
do $do$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $do$;
SQL

echo "== applying migrations =="
for f in "$REPO"/supabase/migrations/*.sql; do
  if $Q -f "$f" >/dev/null 2>"$PGROOT/err"; then
    echo "  OK   $(basename "$f")"
  else
    echo "  FAIL $(basename "$f")"; head -8 "$PGROOT/err"; exit 1
  fi
done

pass=0; fail=0
ck() { if [ "$2" = "$3" ]; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1 — got '$2', want '$3'"; fail=$((fail+1)); fi; }
newuser() { $Q -c "insert into auth.users(email) values ('$1') returning id"; }
# One psql -c, therefore one transaction — the whole point of this harness.
as() { $Q -c "set request.jwt.claim.sub = '$1'; $2"; }
# Same, but as the `authenticated` role, so row-level security applies (the default connection is
# a superuser, which bypasses it — fine for calling SECURITY DEFINER functions, useless for
# proving what a signed-in client can and cannot read).
asrls() { $Q -c "set request.jwt.claim.sub = '$1'; set role authenticated; $2"; }
# Joining is request + chef approval since 0008. Echoes the request's status.
ask() { as "$1" "select status from public.request_join('$2', null, 'שם', 'משפחה', null)"; }
approve() { as "$CHEF" "select public.resolve_join_request('$1'::uuid, true, 'cook-$1')"; }
joinas() { ask "$1" "$2" >/dev/null; approve "$1" >/dev/null; }

echo; echo "== rotate_join_code =="
CHEF=$(newuser chef@t); COOK=$(newuser cook@t); OUT=$(newuser out@t)
CODE1=$(as "$CHEF" "select join_code from public.create_restaurant('מטבח','{\"schemaVersion\":5}'::jsonb,5)")
CODE2=$(as "$CHEF" "select public.rotate_join_code()")
ck "the rotated code differs from the original" "$([ -n "$CODE2" ] && [ "$CODE1" != "$CODE2" ] && echo y)" "y"
ck "the OLD code no longer joins" "$(ask "$COOK" "$CODE1")" "invalid_code"
ck "the NEW code is accepted as a request" "$(ask "$COOK" "$CODE2")" "pending"
approve "$COOK" >/dev/null
ck "a cook cannot rotate" "$(as "$COOK" "select public.rotate_join_code()" 2>&1 >/dev/null | grep -c chef_only)" "1"
ck "a non-member cannot rotate" "$(as "$OUT" "select public.rotate_join_code()" 2>&1 >/dev/null | grep -c not_a_member)" "1"

echo; echo "== join-attempt limiting, one transaction per call =="
$Q -c "update public.app_config set join_quota_user = 3, join_quota_global = 4 where id;" >/dev/null
GUESS=$(newuser guess@t)
for i in 1 2 3; do
  st=$(ask "$GUESS" "ZZZZZZ")
  ck "wrong guess $i is reported as an invalid code" "$st" "invalid_code"
done
ck "the per-account counter SURVIVED three refusals" \
   "$($Q -c "select used from public.scan_usage where scope='join_user' and scope_id='$GUESS'")" "3"
ck "the 4th guess is cut off" "$(ask "$GUESS" "ZZZZZZ")" "rate_limited"
ck "the global failure counter SURVIVED too" \
   "$($Q -c "select used>=3 from public.scan_usage where scope='join_global'")" "t"

echo; echo "== the asymmetry: a correct code must work with the global bucket full =="
$Q -c "update public.scan_usage set used = 999 where scope='join_global';" >/dev/null
LATE=$(newuser late@t)
ck "a CORRECT code is still accepted" "$(ask "$LATE" "$CODE2")" "pending"
ck "and approving it makes a real membership" "$(approve "$LATE" >/dev/null; $Q -c "select count(*) from public.memberships where user_id='$LATE'")" "1"
STRANGER=$(newuser stranger@t)
ck "a wrong code is refused on the global cap, not reported as invalid" \
   "$(ask "$STRANGER" "QQQQQQ")" "rate_limited"


echo; echo "== 0008: joining needs a chef's approval =="
RID1=$($Q -c "select restaurant_id from public.memberships where user_id='$CHEF'")
$Q -c "update public.app_config set join_quota_user = 1000, join_quota_global = 100000 where id;" >/dev/null
$Q -c "update public.scan_usage set used = 0 where scope in ('join_user','join_global');" >/dev/null

P1=$(newuser p1@t)
ck "the legacy join_restaurant creates nothing and says so" \
   "$(as "$P1" "select status from public.join_restaurant('$CODE2')")" "approval_required"
ck "...and no request exists after it" "$($Q -c "select count(*) from public.join_requests where user_id='$P1'")" "0"
ck "a request by code is pending" "$(ask "$P1" "$CODE2")" "pending"
ck "asking twice is idempotent, not an error" "$(ask "$P1" "$CODE2")" "pending"
ck "pending is NOT a membership" "$($Q -c "select count(*) from public.memberships where user_id='$P1'")" "0"
ck "my_join_status reports pending with the kitchen name" \
   "$(as "$P1" "select status||'|'||restaurant_name from public.my_join_status()")" "pending|מטבח"

echo; echo "== 0008: a pending person can read nothing of the kitchen =="
ck "control: the chef can read their snapshot under RLS" "$(asrls "$CHEF" "select count(*) from public.snapshots")" "1"
ck "pending: no snapshot rows" "$(asrls "$P1" "select count(*) from public.snapshots")" "0"
ck "pending: no restaurant rows" "$(asrls "$P1" "select count(*) from public.restaurants")" "0"
ck "pending: no ops" "$(asrls "$P1" "select count(*) from public.ops")" "0"
ck "pending: no membership rows" "$(asrls "$P1" "select count(*) from public.memberships")" "0"
ck "pending: cannot append ops" \
   "$(as "$P1" "select 1 from public.append_ops('$RID1'::uuid,'x','[]'::jsonb)" 2>&1 >/dev/null | grep -c not_a_member)" "1"
ck "join_requests is unreachable by a client" \
   "$(asrls "$P1" "select count(*) from public.join_requests" 2>&1 >/dev/null | grep -c 'permission denied')" "1"
ck "invites is unreachable by a client" \
   "$(asrls "$CHEF" "select count(*) from public.invites" 2>&1 >/dev/null | grep -c 'permission denied')" "1"

echo; echo "== 0008: the chef's side =="
ck "a cook cannot list requests" "$(as "$COOK" "select * from public.list_join_requests()" 2>&1 >/dev/null | grep -c chef_only)" "1"
ck "the chef sees the pending request with the typed name" \
   "$(as "$CHEF" "select first_name||' '||last_name from public.list_join_requests() where user_id='$P1'")" "שם משפחה"
ck "a cook cannot resolve a request" \
   "$(as "$COOK" "select public.resolve_join_request('$P1'::uuid, true, 'c1')" 2>&1 >/dev/null | grep -c chef_only)" "1"
ck "approving needs a cook id" \
   "$(as "$CHEF" "select public.resolve_join_request('$P1'::uuid, true, '')" 2>&1 >/dev/null | grep -c cook_id_required)" "1"
ck "approve returns approved" "$(as "$CHEF" "select public.resolve_join_request('$P1'::uuid, true, 'cook-p1')")" "approved"
ck "the membership exists as a cook bound to that cook id" \
   "$($Q -c "select role||'|'||cook_id||'|'||can_edit_recipes::text||'|'||can_delete_recipes::text from public.memberships where user_id='$P1'")" "cook|cook-p1|false|false"
ck "the request row is gone" "$($Q -c "select count(*) from public.join_requests where user_id='$P1'")" "0"
ck "approving again finds no request" \
   "$(as "$CHEF" "select public.resolve_join_request('$P1'::uuid, true, 'cook-p1')" 2>&1 >/dev/null | grep -c no_such_request)" "1"
ck "the approved cook can now read the snapshot" "$(asrls "$P1" "select count(*) from public.snapshots")" "1"
ck "my_join_status now says member" "$(as "$P1" "select status from public.my_join_status()")" "member"
ck "a member asking to join again is told so" "$(ask "$P1" "$CODE2")" "already_member"

echo; echo "== 0008: rejection =="
P2=$(newuser p2@t)
ask "$P2" "$CODE2" >/dev/null
ck "reject returns rejected" "$(as "$CHEF" "select public.resolve_join_request('$P2'::uuid, false, null)")" "rejected"
ck "the rejected person sees rejected" "$(as "$P2" "select status from public.my_join_status()")" "rejected"
ck "a rejected request is not a to-do for the chef" \
   "$(as "$CHEF" "select count(*) from public.list_join_requests() where user_id='$P2'")" "0"
ck "a rejected person is still not a member" "$($Q -c "select count(*) from public.memberships where user_id='$P2'")" "0"
as "$P2" "select public.dismiss_join_rejection()" >/dev/null
ck "after dismissing, the status is none" "$(as "$P2" "select status from public.my_join_status()")" "none"
ck "and they can ask again" "$(ask "$P2" "$CODE2")" "pending"
as "$CHEF" "select public.resolve_join_request('$P2'::uuid, false, null)" >/dev/null
ck "asking again over a rejection replaces it" "$(ask "$P2" "$CODE2")" "pending"
ck "...without leaving two rows" "$($Q -c "select count(*) from public.join_requests where user_id='$P2'")" "1"
as "$P2" "select public.dismiss_join_rejection()" >/dev/null

echo; echo "== 0008: invites =="
ck "a cook cannot create an invite" "$(as "$COOK" "select public.create_invite()" 2>&1 >/dev/null | grep -c chef_only)" "1"
ck "a non-member cannot" "$(as "$OUT" "select public.create_invite()" 2>&1 >/dev/null | grep -c not_a_member)" "1"
TOK=$(as "$CHEF" "select public.create_invite()")
ck "the token is 32 hex characters" "$(echo "$TOK" | grep -Ec '^[0-9a-f]{32}$')" "1"
ck "only a hash is stored, never the token" "$($Q -c "select count(*) from public.invites where token_hash = '$TOK'")" "0"
ck "peek says valid and names the kitchen" "$(as "$P2" "select status||'|'||restaurant_name from public.peek_invite('$TOK')")" "valid|מטבח"
ck "peek on garbage says invalid" "$(as "$P2" "select status from public.peek_invite('nope')")" "invalid"
ck "a bad name is refused WITHOUT burning the link" \
   "$(as "$P2" "select status from public.request_join(null, '$TOK', '', 'x', null)")" "invalid_name"
ck "...the invite is still unused" "$($Q -c "select count(*) from public.invites where used_at is null and token_hash <> ''")" "1"
ck "a valid token yields a pending request" \
   "$(as "$P2" "select status from public.request_join(null, '$TOK', 'יוסי', 'כהן', ' 050-1234567 ')")" "pending"
ck "the invite is now used, by that person" "$($Q -c "select used_by='$P2' from public.invites where used_at is not null")" "t"
ck "the phone is stored trimmed" "$($Q -c "select phone from public.join_requests where user_id='$P2'")" "050-1234567"
ck "peek on the used link says used" "$(as "$OUT" "select status from public.peek_invite('$TOK')")" "used"
ck "a second person cannot reuse the link" \
   "$(as "$OUT" "select status from public.request_join(null, '$TOK', 'א', 'ב', null)")" "invalid_invite"
as "$CHEF" "select public.resolve_join_request('$P2'::uuid, true, 'cook-p2')" >/dev/null

TOK2=$(as "$CHEF" "select public.create_invite()")
$Q -c "update public.invites set expires_at = now() - interval '1 hour' where token_hash = encode(sha256(convert_to('$TOK2','UTF8')),'hex');" >/dev/null
ck "an expired link is reported expired" "$(as "$OUT" "select status from public.peek_invite('$TOK2')")" "expired"
ck "an expired link cannot be used" \
   "$(as "$OUT" "select status from public.request_join(null, '$TOK2', 'א', 'ב', null)")" "invalid_invite"

echo; echo "== 0008: a failed lookup counts, and a live invite beats a full global bucket =="
$Q -c "update public.app_config set join_quota_global = 2 where id;" >/dev/null
$Q -c "update public.scan_usage set used = 0 where scope = 'join_global';" >/dev/null
for i in 1 2; do
  U=$(newuser "g$i@t")
  as "$U" "select status from public.request_join(null, 'badtoken$i', 'א', 'ב', null)" >/dev/null
done
ck "a failed token lookup bumps the global counter" \
   "$($Q -c "select used from public.scan_usage where scope='join_global'")" "2"
U3=$(newuser g3@t)
ck "past the ceiling, a bad lookup is rate limited" \
   "$(as "$U3" "select status from public.request_join(null, 'badtoken3', 'א', 'ב', null)")" "rate_limited"
TOK3=$(as "$CHEF" "select public.create_invite()")
ck "...but a LIVE invite still works with the bucket full" \
   "$(as "$U3" "select status from public.request_join(null, '$TOK3', 'א', 'ב', null)")" "pending"
as "$CHEF" "select public.resolve_join_request('$U3'::uuid, false, null)" >/dev/null
$Q -c "update public.app_config set join_quota_global = 100000 where id;" >/dev/null

echo; echo "== 0008: a cap on waiting requests =="
$Q -c "delete from public.join_requests;" >/dev/null
for i in $(seq 20); do
  U=$(newuser "f$i@t")
  $Q -c "insert into public.join_requests(user_id, restaurant_id, first_name, last_name) values ('$U','$RID1','א','ב')" >/dev/null
done
OVER=$(newuser over@t)
ck "the 21st waiting request is refused as full" "$(ask "$OVER" "$CODE2")" "full"
ck "and nothing was written" "$($Q -c "select count(*) from public.join_requests where user_id='$OVER'")" "0"
$Q -c "delete from public.join_requests;" >/dev/null

echo; echo "== 0008: station actions are chef-only =="
op() { echo "jsonb_build_array(jsonb_build_object('op_id', gen_random_uuid(), 'action', '{\"type\":\"$1\"}'::jsonb))"; }
ck "a cook cannot rename a station" \
   "$(as "$COOK" "select 1 from public.append_ops('$RID1'::uuid,'c',$(op RENAME_STATION))" 2>&1 >/dev/null | grep -c forbidden_action)" "1"
ck "a cook cannot delete a station" \
   "$(as "$COOK" "select 1 from public.append_ops('$RID1'::uuid,'c',$(op DELETE_STATION))" 2>&1 >/dev/null | grep -c forbidden_action)" "1"
ck "a cook can still add one" "$(as "$COOK" "select count(*) from public.append_ops('$RID1'::uuid,'c',$(op ADD_STATION))")" "1"
ck "a chef can rename one" "$(as "$CHEF" "select count(*) from public.append_ops('$RID1'::uuid,'c',$(op RENAME_STATION))")" "1"
ck "a chef can delete one" "$(as "$CHEF" "select count(*) from public.append_ops('$RID1'::uuid,'c',$(op DELETE_STATION))")" "1"
ck "a forbidden batch took no sequence numbers" \
   "$($Q -c "select last_seq = (select max(seq) from public.ops where restaurant_id='$RID1') from public.restaurants where id='$RID1'")" "t"

echo; echo "== 0010: standing tasks are chef-only, but the day-start action is open =="
for T in ADD_RECURRING_TASK UPDATE_RECURRING_TASK DELETE_RECURRING_TASK; do
  ck "a cook cannot send $T" \
     "$(as "$COOK" "select 1 from public.append_ops('$RID1'::uuid,'c',$(op $T))" 2>&1 >/dev/null | grep -c forbidden_action)" "1"
  ck "a chef can send $T" "$(as "$CHEF" "select count(*) from public.append_ops('$RID1'::uuid,'c',$(op $T))")" "1"
done
ck "a cook CAN send MATERIALIZE_RECURRING — whichever device opens first makes today's tasks" \
   "$(as "$COOK" "select count(*) from public.append_ops('$RID1'::uuid,'c',$(op MATERIALIZE_RECURRING))")" "1"
for T in SET_STATION_COOK SAVE_SUPPLIER DELETE_SUPPLIER; do
  ck "0011: a cook cannot send $T" \
     "$(as "$COOK" "select 1 from public.append_ops('$RID1'::uuid,'c',$(op $T))" 2>&1 >/dev/null | grep -c forbidden_action)" "1"
  ck "0011: a chef can send $T" "$(as "$CHEF" "select count(*) from public.append_ops('$RID1'::uuid,'c',$(op $T))")" "1"
done
ck "a rejected batch of standing-task ops took no sequence numbers" \
   "$($Q -c "select last_seq = (select max(seq) from public.ops where restaurant_id='$RID1') from public.restaurants where id='$RID1'")" "t"

echo; echo "== 0008: a pending person's account can be erased, and takes the request with it =="
PD=$(newuser pd@t)
ask "$PD" "$CODE2" >/dev/null
ck "the request exists" "$($Q -c "select count(*) from public.join_requests where user_id='$PD'")" "1"
as "$PD" "select public.delete_my_account()" >/dev/null
ck "the request went with the account" "$($Q -c "select count(*) from public.join_requests where user_id='$PD'")" "0"

echo; echo "== 0009: member contacts =="
as "$COOK" "select public.set_my_phone('050-1234567')" >/dev/null
ck "a member can save their own number" "$(as "$COOK" "select public.get_my_phone()")" "050-1234567"
NM=$(newuser nomember@t)
ck "a non-member cannot save a number" "$(as "$NM" "select public.set_my_phone('050-1')" 2>&1 >/dev/null | grep -c not_a_member)" "1"
ck "a number over 20 characters is refused" \
   "$(as "$COOK" "select public.set_my_phone('$(printf '1%.0s' $(seq 21))')" 2>&1 >/dev/null | grep -c phone_too_long)" "1"
ck "a refused number left the old one in place" "$(as "$COOK" "select public.get_my_phone()")" "050-1234567"
ck "a chef sees every member, with the cook's number and e-mail" \
   "$(as "$CHEF" "select phone || '|' || email from public.list_team_contacts() where user_id = '$COOK'")" "050-1234567|cook@t"
ck "a chef's list has one row per member" \
   "$(as "$CHEF" "select count(*) from public.list_team_contacts()")" \
   "$($Q -c "select count(*) from public.memberships where restaurant_id='$RID1'")"
ck "a cook's list holds only the chef" "$(as "$COOK" "select count(*) from public.list_team_contacts() where role <> 'chef'")" "0"
ck "...and never an e-mail address" "$(as "$COOK" "select count(email) from public.list_team_contacts()")" "0"
ck "a non-member gets no list" "$(as "$NM" "select 1 from public.list_team_contacts()" 2>&1 >/dev/null | grep -c not_a_member)" "1"
ck "the table itself is closed to a signed-in client" \
   "$(asrls "$COOK" "select count(*) from public.member_contacts" 2>&1 >/dev/null | grep -c 'permission denied')" "1"
as "$COOK" "select public.set_my_phone('   ')" >/dev/null
ck "an empty number clears it" "$([ -z "$(as "$COOK" "select public.get_my_phone()")" ] && echo y)" "y"
PH=$(newuser phone@t)
as "$PH" "select status from public.request_join('$CODE2', null, 'א', 'ב', '052-9998888')" >/dev/null
approve "$PH" >/dev/null
ck "approving a request keeps the number the cook typed" "$(as "$PH" "select public.get_my_phone()")" "052-9998888"
as "$CHEF" "select public.remove_member('$PH'::uuid)" >/dev/null
ck "removing the member removes their number" "$($Q -c "select count(*) from public.member_contacts where user_id='$PH'")" "0"

echo; echo "== 0011: several chefs, one owner =="
OWN=$(newuser own@t); C2=$(newuser c2@t); C3=$(newuser c3@t)
OCODE=$(as "$OWN" "select join_code from public.create_restaurant('בעלים','{\"schemaVersion\":5}'::jsonb,5)")
ORID=$($Q -c "select restaurant_id from public.memberships where user_id='$OWN'")
for U in "$C2" "$C3"; do
  ask "$U" "$OCODE" >/dev/null
  as "$OWN" "select public.resolve_join_request('$U'::uuid, true, 'cook-$U')" >/dev/null
done
role() { $Q -c "select role from public.memberships where user_id='$1'"; }
perm() { as "$1" "select public.set_member_permissions('$2'::uuid, '$3', false, false)" 2>&1 >/dev/null; }
ck "a new restaurant is owned by its creator" "$($Q -c "select owner_id = '$OWN' from public.restaurants where id='$ORID'")" "t"
ck "the owner can make a cook a chef" "$(perm "$OWN" "$C2" chef; role "$C2")" "chef"
ck "a second chef cannot make a chef" "$(perm "$C2" "$C3" chef | grep -c owner_only)" "1"
ck "...and the cook is still a cook" "$(role "$C3")" "cook"
ck "a second chef can still change a cook's recipe permissions" \
   "$(as "$C2" "select public.set_member_permissions('$C3'::uuid, 'cook', true, false)" >/dev/null 2>&1; $Q -c "select can_edit_recipes from public.memberships where user_id='$C3'")" "t"
ck "a second chef cannot demote the owner" "$(perm "$C2" "$OWN" cook | grep -c owner_only)" "1"
ck "a second chef cannot remove the owner" \
   "$(as "$C2" "select public.remove_member('$OWN'::uuid)" 2>&1 >/dev/null | grep -c owner_protected)" "1"
perm "$OWN" "$C3" chef >/dev/null
ck "a second chef cannot remove another chef" \
   "$(as "$C2" "select public.remove_member('$C3'::uuid)" 2>&1 >/dev/null | grep -c owner_only)" "1"
ck "a chef can step down by themselves" "$(perm "$C3" "$C3" cook; role "$C3")" "cook"
ck "a second chef can remove a cook" \
   "$(as "$C2" "select public.remove_member('$C3'::uuid)" >/dev/null 2>&1; $Q -c "select count(*) from public.memberships where user_id='$C3'")" "0"
ck "the owner cannot step down without handing over" "$(perm "$OWN" "$OWN" cook | grep -c owner_must_transfer)" "1"
ck "the owner cannot delete their account without handing over" \
   "$(as "$OWN" "select public.delete_my_account()" 2>&1 >/dev/null | grep -c owner_must_transfer)" "1"
ck "only the owner can hand over" \
   "$(as "$C2" "select public.transfer_ownership('$C2'::uuid)" 2>&1 >/dev/null | grep -c owner_only)" "1"
C4=$(newuser c4@t); ask "$C4" "$OCODE" >/dev/null
as "$OWN" "select public.resolve_join_request('$C4'::uuid, true, 'cook-c4')" >/dev/null
ck "ownership goes only to a chef" \
   "$(as "$OWN" "select public.transfer_ownership('$C4'::uuid)" 2>&1 >/dev/null | grep -c transfer_needs_chef)" "1"
as "$OWN" "select public.transfer_ownership('$C2'::uuid)" >/dev/null
ck "the owner can hand over to a chef" "$($Q -c "select owner_id = '$C2' from public.restaurants where id='$ORID'")" "t"
ck "the former owner is still a chef" "$(role "$OWN")" "chef"
ck "...and may now step down" "$(perm "$OWN" "$OWN" cook; role "$OWN")" "cook"
ck "the new owner can promote" "$(perm "$C2" "$C4" chef; role "$C4")" "chef"
$Q -c "delete from auth.users where id='$C2'" >/dev/null
ck "with the owner gone, any chef acts as owner" "$(perm "$C4" "$OWN" chef; role "$OWN")" "chef"

echo; echo "== delete_my_account =="
# The cook authors an op first, so we can see what deletion does to the restaurant's history.
as "$COOK" "select 1 from public.append_ops('$(as "$CHEF" "select restaurant_id from public.memberships where user_id='$CHEF'")'::uuid, 'dev-cook', jsonb_build_array(jsonb_build_object('op_id', gen_random_uuid(), 'action', '{\"type\":\"SET_PRODUCT_QTY\"}'::jsonb)))" >/dev/null
RID=$($Q -c "select restaurant_id from public.memberships where user_id='$CHEF'")
ck "the cook authored an op" "$($Q -c "select count(*) from public.ops where restaurant_id='$RID' and client_id='dev-cook'")" "1"
ck "the last chef of a staffed kitchen is refused" \
   "$(as "$CHEF" "select public.delete_my_account()" 2>&1 >/dev/null | grep -c last_chef_account)" "1"
ck "a cook can delete their own account" \
   "$(as "$COOK" "select public.delete_my_account()->>'restaurantDeleted'")" "false"
ck "their auth.users row is really gone" "$($Q -c "select count(*) from auth.users where id='$COOK'")" "0"
ck "the op SURVIVES — history is the restaurant's, not the person's" \
   "$($Q -c "select count(*) from public.ops where restaurant_id='$RID' and client_id='dev-cook'")" "1"
ck "but its author link is severed" \
   "$($Q -c "select user_id is null from public.ops where client_id='dev-cook'")" "t"
# Everyone approved along the way has to go too, to leave the chef alone.
for U in "$LATE" "$P1" "$P2"; do as "$U" "select public.delete_my_account()" >/dev/null; done
ck "the last member takes the restaurant with them" \
   "$(as "$CHEF" "select public.delete_my_account()->>'restaurantDeleted'")" "true"
ck "the restaurant row is gone" "$($Q -c "select count(*) from public.restaurants where id='$RID'")" "0"
ck "and its snapshot cascaded" "$($Q -c "select count(*) from public.snapshots where restaurant_id='$RID'")" "0"

echo; echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
