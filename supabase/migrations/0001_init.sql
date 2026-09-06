-- Kitchen app: multi-device sync schema.
-- Run this once in the Supabase SQL Editor (or via `supabase db push`) on a fresh project.
--
-- Design notes (see CLAUDE.md / the sync plan for the full rationale):
--   * `ops` is an append-only log per restaurant. Every write goes through append_ops(), which
--     allocates seq numbers from restaurants.last_seq under a row lock, so seq is a truly
--     contiguous 1..N sequence PER RESTAURANT (a plain `bigserial` would leave holes across
--     restaurants and make gap detection meaningless).
--   * `snapshots` holds the big jsonb blob separately so `restaurants` stays small and cheap to
--     put in the realtime publication.
--   * RLS only ever grants SELECT. Every write is a SECURITY DEFINER RPC, because RLS alone
--     can't express "insert only if you're already a member" for the bootstrapping case
--     (joining a restaurant) or "assign the next seq under a lock" for appends.

create extension if not exists pgcrypto;

-- ── tables ──────────────────────────────────────────────────────────────────

create table public.restaurants (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(btrim(name)) between 1 and 80),
  join_code      text not null unique,
  schema_version int  not null,
  last_seq       bigint not null default 0,   -- highest seq allocated so far
  snapshot_seq   bigint not null default 0,   -- seq the current snapshot reflects
  created_by     uuid not null references auth.users(id),
  created_at     timestamptz not null default now()
);

create table public.snapshots (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  seq           bigint not null,
  state         jsonb  not null,
  updated_at    timestamptz not null default now()
);

create table public.memberships (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  cook_id       text,                                     -- AppState Cook.id this account is
  role          text not null default 'member' check (role in ('owner', 'member')),
  created_at    timestamptz not null default now(),
  primary key (restaurant_id, user_id)
);
-- v1: one restaurant per user account — removes the need for a restaurant picker UI, and
-- together with create_restaurant()'s single transaction makes "two devices both seed a new
-- restaurant" structurally impossible rather than merely unlikely.
create unique index memberships_one_per_user on public.memberships (user_id);

create table public.ops (
  restaurant_id uuid   not null references public.restaurants(id) on delete cascade,
  seq           bigint not null,                          -- contiguous 1..N per restaurant
  op_id         uuid   not null,                          -- client-generated; resend is a no-op
  client_id     text   not null,                          -- per-device, for debugging only
  user_id       uuid   not null references auth.users(id),
  action        jsonb  not null,
  created_at    timestamptz not null default now(),
  primary key (restaurant_id, seq)
);
create unique index ops_dedup on public.ops (restaurant_id, op_id);

-- ── helpers (SECURITY DEFINER: bypass RLS so policies don't recurse) ─────────

create or replace function public.is_member(p_restaurant_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.memberships m
    where m.restaurant_id = p_restaurant_id and m.user_id = auth.uid()
  );
$$;

create or replace function public.gen_join_code() returns text
language sql volatile as $$
  -- 32-char unambiguous alphabet: no O/0/I/1, so a cook reading it aloud can't confuse them.
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, 6);
$$;

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table public.restaurants enable row level security;
alter table public.snapshots   enable row level security;
alter table public.memberships enable row level security;
alter table public.ops         enable row level security;

create policy restaurants_read on public.restaurants
  for select to authenticated using (public.is_member(id));

create policy snapshots_read on public.snapshots
  for select to authenticated using (public.is_member(restaurant_id));

-- Non-recursive: your own row directly, teammates' rows via the DEFINER helper.
create policy memberships_read on public.memberships
  for select to authenticated
  using (user_id = auth.uid() or public.is_member(restaurant_id));

create policy ops_read on public.ops
  for select to authenticated using (public.is_member(restaurant_id));

-- Deliberately no INSERT/UPDATE/DELETE policies anywhere: every write goes through an RPC below.
-- (postgres_changes realtime events are filtered per-subscriber by each table's SELECT policy,
-- which is why this is enough — no separate realtime-specific grant is needed.)

-- ── RPCs ────────────────────────────────────────────────────────────────────

-- Creates a restaurant, seeds its snapshot, and makes the caller its owner — all in one
-- transaction, so no other client can ever observe a restaurant that exists without an owner
-- or a join code that isn't unique yet.
create or replace function public.create_restaurant(
  p_name text, p_snapshot jsonb, p_schema_version int
) returns table (restaurant_id uuid, join_code text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_code text; v_uid uuid := auth.uid(); v_try int := 0;
begin
  if v_uid is null then raise exception 'auth required' using errcode = '42501'; end if;
  if exists (select 1 from public.memberships where user_id = v_uid) then
    raise exception 'already_member' using errcode = '23505';
  end if;
  loop
    v_try := v_try + 1;
    v_code := public.gen_join_code();
    begin
      insert into public.restaurants (name, join_code, schema_version, created_by)
      values (btrim(p_name), v_code, p_schema_version, v_uid)
      returning id into v_id;
      exit;
    exception when unique_violation then
      if v_try > 10 then raise; end if;
    end;
  end loop;
  insert into public.snapshots (restaurant_id, seq, state) values (v_id, 0, p_snapshot);
  insert into public.memberships (restaurant_id, user_id, role) values (v_id, v_uid, 'owner');
  return query select v_id, v_code;
end $$;

-- Must be SECURITY DEFINER: the caller can't SELECT a restaurants row (RLS requires membership)
-- until this function has already inserted their membership.
create or replace function public.join_restaurant(p_code text)
returns table (restaurant_id uuid, name text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_name text; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'auth required' using errcode = '42501'; end if;
  select r.id, r.name into v_id, v_name
    from public.restaurants r where r.join_code = upper(btrim(p_code));
  if v_id is null then raise exception 'invalid_code' using errcode = 'P0002'; end if;
  -- Named-constraint form, not `on conflict (restaurant_id, user_id)`: this function's own
  -- `returns table (restaurant_id, ...)` declares restaurant_id as an OUT parameter, and a bare
  -- column-list conflict target is ambiguous between that variable and the table's column
  -- (raises 42702 at call time, not at CREATE FUNCTION time — only caught by actually calling it).
  insert into public.memberships (restaurant_id, user_id, role)
  values (v_id, v_uid, 'member')
  on conflict on constraint memberships_pkey do nothing;  -- unique(user_id) still blocks a 2nd restaurant
  return query select v_id, v_name;
end $$;

create or replace function public.set_my_cook(p_restaurant_id uuid, p_cook_id text)
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.memberships set cook_id = p_cook_id
   where restaurant_id = p_restaurant_id and user_id = auth.uid();
$$;

-- The write path every dispatched action goes through. Dedupes op_ids BEFORE allocating seq,
-- so a network retry of the same batch never burns a seq number and per-restaurant seq stays
-- truly contiguous (the client's gap detection depends on that).
create or replace function public.append_ops(
  p_restaurant_id uuid, p_client_id text, p_ops jsonb  -- [{op_id, action}, …] in causal order
) returns table (seq bigint, op_id uuid, action jsonb, created_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_last bigint; v_uid uuid := auth.uid(); v_n int;
begin
  if not public.is_member(p_restaurant_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  v_n := coalesce(jsonb_array_length(p_ops), 0);
  if v_n = 0   then return; end if;
  if v_n > 200 then raise exception 'batch_too_large'; end if;

  -- Serializes concurrent writers for this restaurant.
  select r.last_seq into v_last from public.restaurants r
   where r.id = p_restaurant_id for update;
  if not found then raise exception 'no_such_restaurant' using errcode = 'P0002'; end if;

  return query
  with incoming as (
    select (e ->> 'op_id')::uuid as op_id, e -> 'action' as action, ord
      from jsonb_array_elements(p_ops) with ordinality as t(e, ord)
  ), fresh as (
    select i.op_id, i.action, row_number() over (order by i.ord) as rn
      from incoming i
     where not exists (select 1 from public.ops o
                        where o.restaurant_id = p_restaurant_id and o.op_id = i.op_id)
  ), ins as (
    insert into public.ops (restaurant_id, seq, op_id, client_id, user_id, action)
    select p_restaurant_id, v_last + f.rn, f.op_id, p_client_id, v_uid, f.action from fresh f
    returning ops.seq, ops.op_id, ops.action, ops.created_at
  ), bump as (
    update public.restaurants
       set last_seq = v_last + (select count(*) from fresh)
     where id = p_restaurant_id
  )
  select * from ins order by ins.seq;
end $$;

-- Whole-state replace (JSON backup import). Never sent as a normal op — a full AppState can
-- exceed realtime's broadcast size limit and would be silently truncated. Jumps last_seq by
-- 1000 so every other client sees a gap on its next op, resyncs, and picks up the new snapshot.
create or replace function public.reset_snapshot(
  p_restaurant_id uuid, p_snapshot jsonb, p_schema_version int
) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_last bigint; v_new bigint;
begin
  if not public.is_member(p_restaurant_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  select r.last_seq into v_last from public.restaurants r where r.id = p_restaurant_id for update;
  v_new := v_last + 1000;
  delete from public.ops where restaurant_id = p_restaurant_id;
  insert into public.snapshots (restaurant_id, seq, state, updated_at)
  values (p_restaurant_id, v_new, p_snapshot, now())
  on conflict (restaurant_id) do update
    set seq = excluded.seq, state = excluded.state, updated_at = now();
  update public.restaurants
     set last_seq = v_new, snapshot_seq = v_new, schema_version = p_schema_version
   where id = p_restaurant_id;
  return v_new;
end $$;

-- Phase 7: shrinks the server's ops table once it gets long. Guarded by snapshot_seq so a lost
-- race between two clients compacting at once is harmless (whichever commits last just wins).
create or replace function public.compact_snapshot(
  p_restaurant_id uuid, p_seq bigint, p_snapshot jsonb
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_member(p_restaurant_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  update public.snapshots s set seq = p_seq, state = p_snapshot, updated_at = now()
   where s.restaurant_id = p_restaurant_id and s.seq < p_seq;
  if not found then return; end if;
  update public.restaurants set snapshot_seq = p_seq
   where id = p_restaurant_id and snapshot_seq < p_seq;
  delete from public.ops o
   where o.restaurant_id = p_restaurant_id and o.seq <= p_seq - 200;  -- keep a short tail
end $$;

-- ── grants ──────────────────────────────────────────────────────────────────

revoke all on function public.is_member(uuid), public.gen_join_code() from public;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function
  public.create_restaurant(text, jsonb, int),
  public.join_restaurant(text),
  public.set_my_cook(uuid, text),
  public.append_ops(uuid, text, jsonb),
  public.reset_snapshot(uuid, jsonb, int),
  public.compact_snapshot(uuid, bigint, jsonb)
  to authenticated;

-- ── realtime ────────────────────────────────────────────────────────────────
-- ops: new work to fold in. restaurants: snapshot_seq bumps (import/reset, future compaction).
-- snapshots is deliberately NOT published — its jsonb blob is too big for a broadcast payload;
-- clients fetch it directly via bootstrap() instead.

alter publication supabase_realtime add table public.ops;
alter publication supabase_realtime add table public.restaurants;
alter table public.restaurants replica identity full;  -- needed for RLS-filtered UPDATE events

-- ── table-level grants ────────────────────────────────────────────────────────
-- RLS filters *rows*, but PostgREST/supabase-js still needs a baseline table-level grant to
-- even attempt a query as `authenticated` — this project has "Automatically expose new tables"
-- turned off (the safer, explicit-control default), so these are spelled out here rather than
-- relying on that dashboard setting. No INSERT/UPDATE/DELETE grants are needed on any of these
-- tables: every write goes through a SECURITY DEFINER RPC above, which runs as the function's
-- owner regardless of the caller's own table privileges.

grant usage on schema public to authenticated;
grant select on public.restaurants, public.snapshots, public.memberships, public.ops to authenticated;
