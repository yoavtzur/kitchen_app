-- Scan quota + remote kill switch.
--
-- Why this exists: `/api/scan-recipe` costs real money per call and, until this migration,
-- anyone in the world who discovered the URL could spend it. There was no authentication, no
-- authorization and no ceiling.
--
-- Two tables and one function, following the model 0001_init.sql documents at its top: RLS
-- grants SELECT only, and every write is a SECURITY DEFINER RPC — here because "count and judge
-- atomically" cannot be expressed as a policy at all.
--
-- APPLY THIS BY HAND in the Supabase SQL editor before deploying the code that calls it.
-- Nothing in the build applies migrations. The client half is written to fail *open* on a
-- missing/unreadable app_config (see src/lib/appConfig.ts), so the window between deploying and
-- applying is a non-event rather than an outage; the server half fails *closed*, so scanning
-- returns 503 until this lands. That asymmetry is deliberate and is commented in both places.

-- ── app_config: one row, read by everyone, written by nobody ──────────────────

create table public.app_config (
  -- `boolean primary key default true check (id)` is the single-row idiom: only one value can
  -- ever satisfy the check, so a second row is impossible rather than merely discouraged.
  id                    boolean primary key default true check (id),
  maintenance_mode      boolean not null default false,
  maintenance_message   text,
  read_only_mode        boolean not null default false,
  /** Clients older than this stop sending writes. Compared segment by segment as numbers; a
    * client whose own version can't be parsed is never locked out (see isClientOutdated). */
  min_client_version    text,
  scan_quota_user       int not null default 20,
  scan_quota_restaurant int not null default 100,
  scan_quota_global     int not null default 1000,
  updated_at            timestamptz not null default now()
);

insert into public.app_config (id) values (true);

alter table public.app_config enable row level security;

-- Readable by `anon` as well as `authenticated`, deliberately: the kill switch has to work for
-- a client whose *auth path itself* is the thing that's broken, and that client has no session
-- to read it with. The row holds no user data — it is seven operational flags.
create policy app_config_read on public.app_config for select to anon, authenticated using (true);

grant select on public.app_config to anon, authenticated;
-- No write policy and no write grant, on purpose. This is changed by hand in the dashboard,
-- which is exactly the property that makes it a trustworthy kill switch: no code path — not a
-- compromised client, not a bug in ours — can flip it.

-- ── scan_usage: three counters per day, reachable only through the RPC ────────

create table public.scan_usage (
  -- Day boundary is Asia/Jerusalem, matching the client's todayStr() (src/lib/date.ts, local
  -- time). UTC would roll the quota over in the middle of evening service.
  day      date not null,
  scope    text not null check (scope in ('user', 'restaurant', 'global')),
  -- The nil UUID for the global scope, so one INSERT ... ON CONFLICT can bump all three
  -- counters in a single statement instead of three round trips through three code paths.
  scope_id uuid not null,
  used     int  not null default 0,
  primary key (day, scope, scope_id)
);

alter table public.scan_usage enable row level security;
-- RLS enabled with NO policy and NO grant whatsoever: `authenticated` cannot select, insert or
-- update this table. consume_scan_quota() is SECURITY DEFINER and is the only reachable path,
-- so a client can neither probe how much of its quota is left nor reset its own counter.
--
-- Retention: ~3 rows per day per entity. If that ever matters, prune with pg_cron — never from
-- inside the RPC, which would put a table scan on the hot path of every scan.

-- ── consume_scan_quota: authorize, count and judge in one transaction ─────────

/**
 * Takes no parameters — everything it needs it reads from `auth.uid()`, so there is nothing a
 * caller can lie about. Returns jsonb:
 *   {"status":"ok","remaining":N}          proceed
 *   {"status":"quota","scope":"user"|…}    refuse, quota exhausted
 *   {"status":"maintenance"}               refuse, switched off
 * and raises 42501 for "no session" and "not a member of any restaurant".
 *
 * Counting happens BEFORE judging, deliberately: hammering an already-locked-out account then
 * costs the attacker exactly as much as a legitimate call, so there is no cheap probe.
 *
 * There is no release_scan_quota() and no refund path, also deliberately — a refund endpoint is
 * itself abusable (force a failure, get your quota back). Instead the endpoint validates the
 * request body, mime type and size *before* calling this, so only a genuine upstream failure
 * ever costs a unit.
 */
create or replace function public.consume_scan_quota() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid        uuid := auth.uid();
  v_restaurant uuid;
  v_cfg        public.app_config;
  v_day        date := (now() at time zone 'Asia/Jerusalem')::date;
  v_nil        uuid := '00000000-0000-0000-0000-000000000000';
  v_q_user     int;
  v_q_rest     int;
  v_q_global   int;
  v_user       int;
  v_rest       int;
  v_global     int;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  -- The single most load-bearing line in this function. Signup is open and email confirmation
  -- is off, so "has a valid JWT" is worth approximately nothing as a control: one POST to
  -- /auth/v1/signup yields one. Requiring a membership turns the attack into "obtain a join
  -- code", which is a different and much smaller problem.
  select m.restaurant_id into v_restaurant
    from public.memberships m
   where m.user_id = v_uid;
  if v_restaurant is null then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  select * into v_cfg from public.app_config where id;
  -- Every read below is coalesced against the same default the column carries, so a missing or
  -- truncated app_config row degrades to sane limits rather than to no limits.
  if coalesce(v_cfg.maintenance_mode, false) then
    return jsonb_build_object('status', 'maintenance');
  end if;
  v_q_user   := coalesce(v_cfg.scan_quota_user, 20);
  v_q_rest   := coalesce(v_cfg.scan_quota_restaurant, 100);
  v_q_global := coalesce(v_cfg.scan_quota_global, 1000);

  -- One statement, three counters. ON CONFLICT DO UPDATE takes a row lock per counter, so two
  -- concurrent scans can never both read "19 used" and both write "20" — which is the entire
  -- reason this is a database function and not three lines of TypeScript.
  with bumped as (
    insert into public.scan_usage (day, scope, scope_id, used)
    values (v_day, 'user', v_uid, 1),
           (v_day, 'restaurant', v_restaurant, 1),
           (v_day, 'global', v_nil, 1)
    on conflict (day, scope, scope_id) do update set used = public.scan_usage.used + 1
    returning scan_usage.scope, scan_usage.used
  )
  select max(b.used) filter (where b.scope = 'user'),
         max(b.used) filter (where b.scope = 'restaurant'),
         max(b.used) filter (where b.scope = 'global')
    into v_user, v_rest, v_global
    from bumped b;

  -- Widest ceiling first: when the global cap is hit, that is the fact worth reporting, not
  -- whichever restaurant happened to make the call.
  if v_global > v_q_global then
    return jsonb_build_object('status', 'quota', 'scope', 'global');
  end if;
  if v_rest > v_q_rest then
    return jsonb_build_object('status', 'quota', 'scope', 'restaurant');
  end if;
  if v_user > v_q_user then
    return jsonb_build_object('status', 'quota', 'scope', 'user');
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'remaining', least(v_q_user - v_user, v_q_rest - v_rest, v_q_global - v_global)
  );
end $$;

revoke all on function public.consume_scan_quota() from public;
grant execute on function public.consume_scan_quota() to authenticated;

-- Phase 6 note: rate-limiting join_restaurant reuses this table with a fourth scope, which will
-- need the `scope` check constraint widened. Left narrow here so today's three scopes are the
-- only ones that can be written today.
