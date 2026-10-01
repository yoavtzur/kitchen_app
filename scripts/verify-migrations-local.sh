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

echo; echo "== rotate_join_code =="
CHEF=$(newuser chef@t); COOK=$(newuser cook@t); OUT=$(newuser out@t)
CODE1=$(as "$CHEF" "select join_code from public.create_restaurant('מטבח','{\"schemaVersion\":5}'::jsonb,5)")
CODE2=$(as "$CHEF" "select public.rotate_join_code()")
ck "the rotated code differs from the original" "$([ -n "$CODE2" ] && [ "$CODE1" != "$CODE2" ] && echo y)" "y"
ck "the OLD code no longer joins" "$(as "$COOK" "select status from public.join_restaurant('$CODE1')")" "invalid_code"
ck "the NEW code does" "$(as "$COOK" "select status from public.join_restaurant('$CODE2')")" "ok"
ck "a cook cannot rotate" "$(as "$COOK" "select public.rotate_join_code()" 2>&1 >/dev/null | grep -c chef_only)" "1"
ck "a non-member cannot rotate" "$(as "$OUT" "select public.rotate_join_code()" 2>&1 >/dev/null | grep -c not_a_member)" "1"

echo; echo "== join-attempt limiting, one transaction per call =="
$Q -c "update public.app_config set join_quota_user = 3, join_quota_global = 4 where id;" >/dev/null
GUESS=$(newuser guess@t)
for i in 1 2 3; do
  st=$(as "$GUESS" "select status from public.join_restaurant('ZZZZZZ')")
  ck "wrong guess $i is reported as an invalid code" "$st" "invalid_code"
done
ck "the per-account counter SURVIVED three refusals" \
   "$($Q -c "select used from public.scan_usage where scope='join_user' and scope_id='$GUESS'")" "3"
ck "the 4th guess is cut off" "$(as "$GUESS" "select status from public.join_restaurant('ZZZZZZ')")" "rate_limited"
ck "the global failure counter SURVIVED too" \
   "$($Q -c "select used>=3 from public.scan_usage where scope='join_global'")" "t"

echo; echo "== the asymmetry: a correct code must work with the global bucket full =="
$Q -c "update public.scan_usage set used = 999 where scope='join_global';" >/dev/null
LATE=$(newuser late@t)
ck "a CORRECT code still joins" "$(as "$LATE" "select status from public.join_restaurant('$CODE2')")" "ok"
ck "and the membership really exists" "$($Q -c "select count(*) from public.memberships where user_id='$LATE'")" "1"
STRANGER=$(newuser stranger@t)
ck "a wrong code is refused on the global cap, not reported as invalid" \
   "$(as "$STRANGER" "select status from public.join_restaurant('QQQQQQ')")" "rate_limited"

echo; echo "== delete_my_account =="
# The cook authors an op first, so we can see what deletion does to the restaurant's history.
as "$COOK" "select 1 from public.append_ops('$(as "$CHEF" "select restaurant_id from public.memberships where user_id='$CHEF'")'::uuid, 'dev-cook', jsonb_build_array(jsonb_build_object('op_id', gen_random_uuid(), 'action', '{\"type\":\"SET_PRODUCT_QTY\"}'::jsonb)))" >/dev/null
RID=$($Q -c "select restaurant_id from public.memberships where user_id='$CHEF'")
ck "the cook authored an op" "$($Q -c "select count(*) from public.ops where restaurant_id='$RID' and user_id='$COOK'")" "1"
ck "the last chef of a staffed kitchen is refused" \
   "$(as "$CHEF" "select public.delete_my_account()" 2>&1 >/dev/null | grep -c last_chef_account)" "1"
ck "a cook can delete their own account" \
   "$(as "$COOK" "select public.delete_my_account()->>'restaurantDeleted'")" "false"
ck "their auth.users row is really gone" "$($Q -c "select count(*) from auth.users where id='$COOK'")" "0"
ck "the op SURVIVES — history is the restaurant's, not the person's" \
   "$($Q -c "select count(*) from public.ops where restaurant_id='$RID' and client_id='dev-cook'")" "1"
ck "but its author link is severed" \
   "$($Q -c "select user_id is null from public.ops where client_id='dev-cook'")" "t"
# LATE joined earlier, so remove them to leave the chef alone.
as "$LATE" "select public.delete_my_account()" >/dev/null
ck "the last member takes the restaurant with them" \
   "$(as "$CHEF" "select public.delete_my_account()->>'restaurantDeleted'")" "true"
ck "the restaurant row is gone" "$($Q -c "select count(*) from public.restaurants where id='$RID'")" "0"
ck "and its snapshot cascaded" "$($Q -c "select count(*) from public.snapshots where restaurant_id='$RID'")" "0"

echo; echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
